import "dotenv/config";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function buildAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const query = new URLSearchParams({
    client_id: params.clientId,
    response_type: "code",
    redirect_uri: params.redirectUri,
    scope: "user-library-read playlist-modify-public user-read-private",
    state: params.state
  });

  return `https://accounts.spotify.com/authorize?${query.toString()}`;
}

function openBrowser(url: string): void {
  const platform = process.platform;

  if (platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  if (platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

function printSetupInstructions(authUrl: string): void {
  console.log("Opening Spotify authorization URL in your browser...");
  console.log("If it does not open automatically, use this URL:\n");
  console.log(authUrl);
  console.log("\nAfter success, this script captures the callback and prints your refresh token.");
}

async function exchangeCodeForToken(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{ refresh_token?: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    client_secret: input.clientSecret
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  return JSON.parse(text) as { refresh_token?: string };
}

async function main(): Promise<void> {
  const clientId = requireEnv("SPOTIFY_CLIENT_ID");
  const clientSecret = requireEnv("SPOTIFY_CLIENT_SECRET");
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI?.trim() || "http://127.0.0.1:8888/callback";
  const port = Number(process.env.SPOTIFY_AUTH_PORT?.trim() || "8888");

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("SPOTIFY_AUTH_PORT must be a valid TCP port number");
  }

  const state = randomBytes(16).toString("hex");
  const authUrl = buildAuthUrl({ clientId, redirectUri, state });

  printSetupInstructions(authUrl);
  openBrowser(authUrl);

  const result = await new Promise<{ code: string; returnedState: string }>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const requestUrl = req.url ? new URL(req.url, `http://127.0.0.1:${port}`) : null;

      if (!requestUrl || requestUrl.pathname !== "/callback") {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      const code = requestUrl.searchParams.get("code");
      const returnedState = requestUrl.searchParams.get("state");
      const error = requestUrl.searchParams.get("error");

      if (error) {
        res.statusCode = 400;
        res.end(`Spotify auth failed: ${error}`);
        server.close(() => reject(new Error(`Spotify auth failed: ${error}`)));
        return;
      }

      if (!code || !returnedState) {
        res.statusCode = 400;
        res.end("Missing code/state in callback.");
        server.close(() => reject(new Error("Missing code/state in callback.")));
        return;
      }

      res.statusCode = 200;
      res.end("Authorization complete. Return to terminal.");
      server.close(() => resolve({ code, returnedState }));
    });

    server.on("error", reject);
    server.listen(port, "127.0.0.1");
  });

  if (result.returnedState !== state) {
    throw new Error("State mismatch in OAuth callback.");
  }

  const tokenResponse = await exchangeCodeForToken({
    code: result.code,
    clientId,
    clientSecret,
    redirectUri
  });

  if (!tokenResponse.refresh_token) {
    throw new Error("Spotify token response did not include refresh_token.");
  }

  console.log("\nRefresh token generated successfully. Add this to GitHub Actions secrets:");
  console.log("SPOTIFY_REFRESH_TOKEN=");
  console.log(tokenResponse.refresh_token);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Auth helper failed: ${message}`);
  process.exitCode = 1;
});
