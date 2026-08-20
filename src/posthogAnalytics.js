import { EVENT_PROPERTY_ALLOWLIST, USER_PROPERTY_ALLOWLIST } from "./events.js";

const DEFAULT_TIMEOUT_MS = 2500;

function compactObject(input = {}) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

function pickAllowed(input = {}, allowed = []) {
  return compactObject(
    Object.fromEntries(allowed.map((key) => [key, input[key]]))
  );
}

function getCaptureHost() {
  if (process.env.POSTHOG_INGEST_HOST) {
    return process.env.POSTHOG_INGEST_HOST.replace(/\/+$/, "");
  }

  const appHost = (process.env.POSTHOG_HOST || "https://us.posthog.com").replace(/\/+$/, "");
  if (appHost === "https://us.posthog.com") return "https://us.i.posthog.com";
  if (appHost === "https://eu.posthog.com") return "https://eu.i.posthog.com";
  return appHost;
}

async function postJson(url, payload, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function createAnalytics({
  posthogKey = process.env.POSTHOG_KEY,
  captureHost = getCaptureHost(),
  disabled = process.env.POSTHOG_DISABLED === "true"
} = {}) {
  async function track(eventName, properties = {}) {
    if (disabled || !posthogKey || !eventName) return false;

    const allowedProperties = EVENT_PROPERTY_ALLOWLIST[eventName] || Object.keys(properties);
    const cleanedProperties = pickAllowed(properties, allowedProperties);
    const distinctId = properties.user_id || properties.distinct_id || "anonymous";

    return postJson(`${captureHost}/capture/`, {
      api_key: posthogKey,
      event: eventName,
      distinct_id: String(distinctId),
      properties: cleanedProperties
    });
  }

  async function identify(userId, userProperties = {}) {
    if (disabled || !posthogKey || !userId) return false;

    return postJson(`${captureHost}/capture/`, {
      api_key: posthogKey,
      event: "$identify",
      distinct_id: String(userId),
      properties: {
        $set: pickAllowed({ user_id: userId, ...userProperties }, USER_PROPERTY_ALLOWLIST)
      }
    });
  }

  return { track, identify };
}

export const analytics = createAnalytics();
