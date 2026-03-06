import { randomUUID } from "node:crypto";
import { DisconnectReason } from "@whiskeysockets/baileys";
import { loadConfig } from "../config/config.js";
import { danger, info, success } from "../globals.js";
import { logInfo } from "../logger.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { resolveWhatsAppAccount } from "./accounts.js";
import { renderQrPngBase64 } from "./qr-image.js";
import {
  createWaSocket,
  formatError,
  getStatusCode,
  logoutWeb,
  readWebSelfId,
  waitForCredsSave,
  waitForWaConnection,
  webAuthExists,
} from "./session.js";

type WaSocket = Awaited<ReturnType<typeof createWaSocket>>;

type ActiveLogin = {
  accountId: string;
  authDir: string;
  isLegacyAuthDir: boolean;
  id: string;
  sock: WaSocket;
  startedAt: number;
  qr?: string;
  qrDataUrl?: string;
  connected: boolean;
  error?: string;
  errorStatus?: number;
  waitPromise: Promise<void>;
  restartAttempted: boolean;
  verbose: boolean;
};

const ACTIVE_LOGIN_TTL_MS = 3 * 60_000;
const activeLogins = new Map<string, ActiveLogin>();

function closeSocket(sock: WaSocket) {
  try {
    sock.ws?.close();
  } catch {
    // ignore
  }
}

async function resetActiveLogin(accountId: string, reason?: string) {
  const login = activeLogins.get(accountId);
  if (login) {
    closeSocket(login.sock);
    activeLogins.delete(accountId);
  }
  if (reason) {
    logInfo(reason);
  }
}

function isLoginFresh(login: ActiveLogin) {
  return Date.now() - login.startedAt < ACTIVE_LOGIN_TTL_MS;
}

function attachLoginWaiter(accountId: string, login: ActiveLogin) {
  login.waitPromise = waitForWaConnection(login.sock)
    .then(() => {
      const current = activeLogins.get(accountId);
      if (current?.id === login.id) {
        current.connected = true;
      }
    })
    .catch((err) => {
      const current = activeLogins.get(accountId);
      if (current?.id !== login.id) {
        return;
      }
      current.error = formatError(err);
      current.errorStatus = getStatusCode(err);
    });
}

async function restartLoginSocket(login: ActiveLogin, runtime: RuntimeEnv) {
  if (login.restartAttempted) {
    return false;
  }
  login.restartAttempted = true;
  runtime.log(
    info("WhatsApp asked for a restart after pairing (code 515); retrying connection once…"),
  );
  closeSocket(login.sock);
  // Wait for Baileys to flush pairing creds to disk before creating the new socket
  // that will read them — eliminating the read-before-write race on `credsSaveQueue`.
  await waitForCredsSave();
  try {
    const sock = await createWaSocket(false, login.verbose, {
      authDir: login.authDir,
    });
    login.sock = sock;
    login.connected = false;
    login.error = undefined;
    login.errorStatus = undefined;
    attachLoginWaiter(login.accountId, login);
    return true;
  } catch (err) {
    login.error = formatError(err);
    login.errorStatus = getStatusCode(err);
    return false;
  }
}

export async function startWebLoginWithQr(
  opts: {
    verbose?: boolean;
    timeoutMs?: number;
    force?: boolean;
    accountId?: string;
    runtime?: RuntimeEnv;
  } = {},
): Promise<{ qrDataUrl?: string; message: string }> {
  const runtime = opts.runtime ?? defaultRuntime;
  const cfg = loadConfig();
  const account = resolveWhatsAppAccount({ cfg, accountId: opts.accountId });
  const hasWeb = await webAuthExists(account.authDir);
  const selfId = readWebSelfId(account.authDir);
  if (hasWeb && !opts.force) {
    const who = selfId.e164 ?? selfId.jid ?? "unknown";
    return {
      message: `WhatsApp is already linked (${who}). Say “relink” if you want a fresh QR.`,
    };
  }

  const existing = activeLogins.get(account.accountId);
  if (existing && isLoginFresh(existing) && existing.qrDataUrl) {
    return {
      qrDataUrl: existing.qrDataUrl,
      message: "QR already active. Scan it in WhatsApp → Linked Devices.",
    };
  }

  await resetActiveLogin(account.accountId);

  let resolveQr: ((qr: string) => void) | null = null;
  let rejectQr: ((err: Error) => void) | null = null;
  const qrPromise = new Promise<string>((resolve, reject) => {
    resolveQr = resolve;
    rejectQr = reject;
  });

  const qrTimer = setTimeout(
    () => {
      rejectQr?.(new Error("Timed out waiting for WhatsApp QR"));
    },
    Math.max(opts.timeoutMs ?? 30_000, 5000),
  );

  let sock: WaSocket;
  let pendingQr: string | null = null;
  try {
    sock = await createWaSocket(false, Boolean(opts.verbose), {
      authDir: account.authDir,
      onQr: (qr: string) => {
        if (pendingQr) {
          return;
        }
        pendingQr = qr;
        const current = activeLogins.get(account.accountId);
        if (current && !current.qr) {
          current.qr = qr;
        }
        clearTimeout(qrTimer);
        runtime.log(info("WhatsApp QR received."));
        resolveQr?.(qr);
      },
    });
  } catch (err) {
    clearTimeout(qrTimer);
    await resetActiveLogin(account.accountId);
    return {
      message: `Failed to start WhatsApp login: ${String(err)}`,
    };
  }
  const login: ActiveLogin = {
    accountId: account.accountId,
    authDir: account.authDir,
    isLegacyAuthDir: account.isLegacyAuthDir,
    id: randomUUID(),
    sock,
    startedAt: Date.now(),
    connected: false,
    waitPromise: Promise.resolve(),
    restartAttempted: false,
    verbose: Boolean(opts.verbose),
  };
  activeLogins.set(account.accountId, login);
  if (pendingQr && !login.qr) {
    login.qr = pendingQr;
  }
  attachLoginWaiter(account.accountId, login);

  let qr: string;
  try {
    qr = await qrPromise;
  } catch (err) {
    clearTimeout(qrTimer);
    // Guard against clobbering a concurrent invocation's login: if another
    // startWebLoginWithQr call replaced our entry in activeLogins while we were
    // waiting (e.g. after a 30-second QR timeout), leave the newer login alone.
    if (activeLogins.get(account.accountId)?.id === login.id) {
      await resetActiveLogin(account.accountId);
    } else {
      closeSocket(login.sock);
    }
    return {
      message: `Failed to get QR: ${String(err)}`,
    };
  }

  const base64 = await renderQrPngBase64(qr);
  login.qrDataUrl = `data:image/png;base64,${base64}`;
  return {
    qrDataUrl: login.qrDataUrl,
    message: "Scan this QR in WhatsApp → Linked Devices.",
  };
}

export async function startWebLoginWithPairingCode(
  phoneNumber: string,
  opts: {
    verbose?: boolean;
    timeoutMs?: number;
    force?: boolean;
    accountId?: string;
    runtime?: RuntimeEnv;
  } = {},
): Promise<{ pairingCode?: string; message: string }> {
  const runtime = opts.runtime ?? defaultRuntime;
  const cfg = loadConfig();
  const account = resolveWhatsAppAccount({ cfg, accountId: opts.accountId });
  const hasWeb = await webAuthExists(account.authDir);
  const selfId = readWebSelfId(account.authDir);

  if (hasWeb && !opts.force) {
    const who = selfId.e164 ?? selfId.jid ?? "unknown";
    return {
      message: `WhatsApp is already linked (${who}). Restart with force=true if needed.`,
    };
  }

  await resetActiveLogin(account.accountId);

  let sock: WaSocket;
  try {
    sock = await createWaSocket(false, Boolean(opts.verbose), {
      authDir: account.authDir,
    });
  } catch (err) {
    await resetActiveLogin(account.accountId);
    return {
      message: `Failed to start WhatsApp login: ${String(err)}`,
    };
  }

  const login: ActiveLogin = {
    accountId: account.accountId,
    authDir: account.authDir,
    isLegacyAuthDir: account.isLegacyAuthDir,
    id: randomUUID(),
    sock,
    startedAt: Date.now(),
    connected: false,
    waitPromise: Promise.resolve(),
    restartAttempted: false,
    verbose: Boolean(opts.verbose),
  };
  activeLogins.set(account.accountId, login);
  attachLoginWaiter(account.accountId, login);

  let pairingCode: string | undefined;
  try {
    // Wait slightly for socket initialization before requesting pairing code
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const code = await sock.requestPairingCode(phoneNumber);
    if (code) {
      pairingCode = code.match(/.{1,4}/g)?.join("-") ?? code; // Format as XXXX-XXXX
      runtime.log(info(`WhatsApp pairing code requested for ${phoneNumber}: ${pairingCode}`));
    }
  } catch (err) {
    await resetActiveLogin(account.accountId);
    return {
      message: `Failed to request pairing code: ${String(err)}`,
    };
  }

  return {
    pairingCode,
    message: `Enter this pairing code in WhatsApp: ${pairingCode}`,
  };
}

export async function waitForWebLogin(
  opts: { timeoutMs?: number; runtime?: RuntimeEnv; accountId?: string } = {},
): Promise<{ connected: boolean; message: string }> {
  const runtime = opts.runtime ?? defaultRuntime;
  const cfg = loadConfig();
  const account = resolveWhatsAppAccount({ cfg, accountId: opts.accountId });
  const activeLogin = activeLogins.get(account.accountId);
  if (!activeLogin) {
    return {
      connected: false,
      message: "No active WhatsApp login in progress.",
    };
  }

  const login = activeLogin;
  if (!isLoginFresh(login)) {
    await resetActiveLogin(account.accountId);
    return {
      connected: false,
      message: "The login QR expired. Ask me to generate a new one.",
    };
  }
  const timeoutMs = Math.max(opts.timeoutMs ?? 120_000, 1000);
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return {
        connected: false,
        message: "Still waiting for the QR scan. Let me know when you’ve scanned it.",
      };
    }
    const timeout = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), remaining),
    );
    const result = await Promise.race([login.waitPromise.then(() => "done"), timeout]);

    if (result === "timeout") {
      return {
        connected: false,
        message: "Still waiting for the QR scan. Let me know when you’ve scanned it.",
      };
    }

    if (login.error) {
      if (login.errorStatus === DisconnectReason.loggedOut) {
        await logoutWeb({
          authDir: login.authDir,
          isLegacyAuthDir: login.isLegacyAuthDir,
          runtime,
        });
        const message =
          "WhatsApp reported the session is logged out. Cleared cached web session; please scan a new QR.";
        await resetActiveLogin(account.accountId, message);
        runtime.log(danger(message));
        return { connected: false, message };
      }
      if (login.errorStatus === 515) {
        if (!login.restartAttempted) {
          // First caller: perform the one-time socket restart that WA 515 requires.
          const restarted = await restartLoginSocket(login, runtime);
          if (restarted && isLoginFresh(login)) {
            continue;
          }
        } else if (isLoginFresh(login)) {
          // A concurrent waitForWebLogin call is already restarting the socket.
          // Calling resetActiveLogin here would kill the newly-created socket, so
          // instead back off briefly and loop back to await the new wait-promise.
          await new Promise<void>((resolve) => setTimeout(resolve, 1500));
          continue;
        }
      }
      const message = `WhatsApp login failed: ${login.error}`;
      await resetActiveLogin(account.accountId, message);
      runtime.log(danger(message));
      return { connected: false, message };
    }

    if (login.connected) {
      const selfId = readWebSelfId(login.authDir);
      const who = selfId.e164 ?? selfId.jid ?? undefined;
      const message = "\u2705 Linked! WhatsApp is ready.";
      runtime.log(success(message));
      await resetActiveLogin(account.accountId);
      return { connected: true, message };
    }

    return { connected: false, message: "Login ended without a connection." };
  }
}

/**
 * QR login flow that mirrors the CLI `loginWeb` exactly: one socket, inline
 * 515-restart with creds-flush wait, no shared `activeLogins` state.
 * The QR is delivered via `opts.onQr` as a PNG data URL.
 * Used by the gateway `web.login.qrSession` handler.
 *
 * Only one session per accountId runs at a time — starting a new session
 * closes a previous one so stale sockets can't trash freshly-saved credentials.
 */

/** Tracks the live socket for each accountId so a new call can cancel the previous one. */
const ongoingQrSessions = new Map<string, WaSocket>();

export async function loginWebWithQrCapture(opts: {
  onQr: (qrDataUrl: string) => void;
  verbose?: boolean;
  force?: boolean;
  accountId?: string;
  runtime?: RuntimeEnv;
}): Promise<{ connected: boolean; message: string; who?: string }> {
  const runtime = opts.runtime ?? defaultRuntime;
  const cfg = loadConfig();
  const account = resolveWhatsAppAccount({ cfg, accountId: opts.accountId });
  const accountId = account.accountId;

  if (!opts.force) {
    const hasWeb = await webAuthExists(account.authDir);
    if (hasWeb) {
      const selfId = readWebSelfId(account.authDir);
      const who = selfId.e164 ?? selfId.jid ?? "unknown";
      return { connected: true, message: `WhatsApp is already linked (${who}).`, who };
    }
  }

  // Close any previous in-flight QR session for this account so we don't have
  // two sockets competing and clobbering each other's credentials on loggedOut.
  const prev = ongoingQrSessions.get(accountId);
  if (prev) {
    closeSocket(prev);
    ongoingQrSessions.delete(accountId);
  }

  const sock = await createWaSocket(false, Boolean(opts.verbose), {
    authDir: account.authDir,
    onQr: async (qr: string) => {
      const base64 = await renderQrPngBase64(qr);
      opts.onQr(`data:image/png;base64,${base64}`);
    },
  });
  ongoingQrSessions.set(accountId, sock);

  try {
    await waitForWaConnection(sock);
    const selfId = readWebSelfId(account.authDir);
    const who = selfId.e164 ?? selfId.jid ?? "unknown";
    return { connected: true, message: `✅ Linked! (${who})`, who };
  } catch (err) {
    const code = getStatusCode(err);
    if (code === 515) {
      runtime.log(info("WhatsApp asked for a restart after pairing (code 515); retrying once…"));
      closeSocket(sock);
      // Wait for Baileys to flush the pairing creds to disk before creating the
      // new socket that will read them — eliminating the read-before-write race.
      await waitForCredsSave();
      const retry = await createWaSocket(false, Boolean(opts.verbose), {
        authDir: account.authDir,
      });
      ongoingQrSessions.set(accountId, retry);
      try {
        await waitForWaConnection(retry);
        const selfId = readWebSelfId(account.authDir);
        const who = selfId.e164 ?? selfId.jid ?? "unknown";
        runtime.log(success("✅ Linked after restart; web session ready."));
        return { connected: true, message: `✅ Linked after restart! (${who})`, who };
      } catch (retryErr) {
        return {
          connected: false,
          message: `WhatsApp login failed after restart: ${formatError(retryErr)}`,
        };
      } finally {
        setTimeout(() => closeSocket(retry), 500);
      }
    }
    // For loggedOut: do NOT call logoutWeb here. A concurrent session (CLI or
    // another browser tab) may have just successfully paired and written valid
    // credentials. Clearing them here would nuke a working session. Just report
    // failure and let the caller decide whether to re-pair.
    return { connected: false, message: `WhatsApp login failed: ${formatError(err)}` };
  } finally {
    // Only remove from the map if this session is still the current one
    // (a newer session may have already replaced it).
    if (ongoingQrSessions.get(accountId) === sock) {
      ongoingQrSessions.delete(accountId);
    }
    setTimeout(() => closeSocket(sock), 500);
  }
}
