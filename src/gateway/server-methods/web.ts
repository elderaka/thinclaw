import { listChannelPlugins } from "../../channels/plugins/index.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateWebLoginStartParams,
  validateWebLoginPairPhoneParams,
  validateWebLoginWaitParams,
} from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

const WEB_LOGIN_METHODS = new Set(["web.login.start", "web.login.pairPhone", "web.login.wait", "web.login.qrSession"]);

const resolveWebLoginProvider = () =>
  listChannelPlugins().find((plugin) =>
    (plugin.gatewayMethods ?? []).some((method) => WEB_LOGIN_METHODS.has(method)),
  ) ?? null;

function resolveAccountId(params: unknown): string | undefined {
  return typeof (params as { accountId?: unknown }).accountId === "string"
    ? (params as { accountId?: string }).accountId
    : undefined;
}

function respondProviderUnavailable(respond: RespondFn) {
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, "web login provider is not available"),
  );
}

function respondProviderUnsupported(respond: RespondFn, providerId: string) {
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, `web login is not supported by provider ${providerId}`),
  );
}

export const webHandlers: GatewayRequestHandlers = {
  "web.login.start": async ({ params, respond, context }) => {
    if (!validateWebLoginStartParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid web.login.start params: ${formatValidationErrors(validateWebLoginStartParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const accountId = resolveAccountId(params);
      const provider = resolveWebLoginProvider();
      if (!provider) {
        respondProviderUnavailable(respond);
        return;
      }
      await context.stopChannel(provider.id, accountId);
      if (!provider.gateway?.loginWithQrStart) {
        respondProviderUnsupported(respond, provider.id);
        return;
      }
      const result = await provider.gateway.loginWithQrStart({
        force: Boolean((params as { force?: boolean }).force),
        timeoutMs:
          typeof (params as { timeoutMs?: unknown }).timeoutMs === "number"
            ? (params as { timeoutMs?: number }).timeoutMs
            : undefined,
        verbose: Boolean((params as { verbose?: boolean }).verbose),
        accountId,
      });
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "web.login.pairPhone": async ({ params, respond, context }) => {
    if (!validateWebLoginPairPhoneParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid web.login.pairPhone params: ${formatValidationErrors(validateWebLoginPairPhoneParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const accountId = resolveAccountId(params);
      const provider = resolveWebLoginProvider();
      if (!provider) {
        respondProviderUnavailable(respond);
        return;
      }
      await context.stopChannel(provider.id, accountId);
      if (!provider.gateway?.loginWithPairingCodeStart) {
        respondProviderUnsupported(respond, provider.id);
        return;
      }
      const result = await provider.gateway.loginWithPairingCodeStart({
        phoneNumber: params.phoneNumber,
        force: Boolean(params.force),
        timeoutMs: params.timeoutMs,
        verbose: Boolean(params.verbose),
        accountId,
      });
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "web.login.wait": async ({ params, respond, context }) => {
    if (!validateWebLoginWaitParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid web.login.wait params: ${formatValidationErrors(validateWebLoginWaitParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const accountId = resolveAccountId(params);
      const provider = resolveWebLoginProvider();
      if (!provider) {
        respondProviderUnavailable(respond);
        return;
      }
      if (!provider.gateway?.loginWithQrWait) {
        respondProviderUnsupported(respond, provider.id);
        return;
      }
      const result = await provider.gateway.loginWithQrWait({
        timeoutMs:
          typeof (params as { timeoutMs?: unknown }).timeoutMs === "number"
            ? (params as { timeoutMs?: number }).timeoutMs
            : undefined,
        accountId,
      });
      if (result.connected) {
        await context.startChannel(provider.id, accountId);
        const message = result.who
          ? `✅ Linked! WhatsApp is ready (${result.who}).`
          : result.message;
        respond(true, { ...result, message }, undefined);
      } else {
        // Auto-logout on login failure so the next attempt starts clean.
        // Exception: stream errors (e.g. status=515 "Unknown Stream Errored") can fire
        // *after* the phone has already scanned and credentials have been written.
        // Clearing in that case destroys a valid pairing.  If no credentials exist the
        // call would have been a no-op anyway, so skipping is always safe here.
        const isStreamError = /\bstream\b/i.test(result.message ?? "");
        if (!isStreamError && provider.gateway.logoutByAccountId) {
          const logoutResult = await provider.gateway.logoutByAccountId({ accountId });
          context.markChannelLoggedOut(provider.id, logoutResult.cleared, accountId);
        }
        respond(true, result, undefined);
      }
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "web.login.qrSession": async ({ params, respond, context, client }) => {
    try {
      const accountId = resolveAccountId(params);
      const provider = resolveWebLoginProvider();
      if (!provider) {
        respondProviderUnavailable(respond);
        return;
      }
      if (!provider.gateway?.loginWithQrSession) {
        respondProviderUnsupported(respond, provider.id);
        return;
      }
      await context.stopChannel(provider.id, accountId);
      const connId = client?.connId;
      const result = await provider.gateway.loginWithQrSession({
        force: Boolean((params as { force?: boolean }).force),
        accountId,
        onQr: (qrDataUrl: string) => {
          if (connId) {
            context.broadcastToConnIds(new Set([connId]), "web.qr", { qrDataUrl });
          }
        },
      });
      if (result.connected) {
        await context.startChannel(provider.id, accountId);
        const message = result.who
          ? `✅ Linked! WhatsApp is ready (${result.who}).`
          : result.message;
        respond(true, { ...result, message }, undefined);
      } else {
        respond(true, result, undefined);
      }
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
};
