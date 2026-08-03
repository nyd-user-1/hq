// AWS SigV4 request signing — pure node:crypto, no dependencies.
// The backstop gateway is a launchd daemon that must survive with zero install
// steps, so signing is implemented here rather than pulled from the AWS SDK.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const hmac = (key, str) => crypto.createHmac("sha256", key).update(str, "utf8").digest();
const sha256hex = (data) => crypto.createHash("sha256").update(data ?? "").digest("hex");

/** Percent-encode one path segment per RFC 3986 (unreserved = A-Za-z0-9-_.~). */
const encodeSegment = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * The canonical URI for SigV4. For every service EXCEPT S3, the path is
 * URI-encoded a SECOND time for signing while the wire request keeps the
 * single-encoded form.
 *
 * This matters here because Bedrock inference-profile ids contain a colon
 * ("…-v1:0"): the wire path carries `%3A`, so the canonical string must carry
 * `%253A`. Signing the wire path verbatim yields a SignatureDoesNotMatch on
 * every classic-Bedrock call — silently, since a mock that does not verify
 * signatures cannot see it.
 */
const canonicalUriFor = (wirePath) => wirePath.split("/").map(encodeSegment).join("/");

/**
 * Sign a request and return the headers to send (input headers + auth headers).
 * `canonicalPath` is the WIRE path (single-encoded, as it appears in the request
 * line); the double-encoding required for signing is applied here.
 * `headers` must NOT already contain authorization/x-amz-date.
 */
export function signRequest({
  method,
  host,
  canonicalPath,
  query = "",
  headers = {},
  body = "",
  region,
  service,
  credentials,
  now = new Date(),
}) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body);

  const signed = { ...headers, host, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash };
  if (credentials.sessionToken) signed["x-amz-security-token"] = credentials.sessionToken;

  const lowered = new Map();
  for (const [k, v] of Object.entries(signed)) lowered.set(k.toLowerCase(), String(v).trim().replace(/\s+/g, " "));
  const names = [...lowered.keys()].sort();

  const canonicalHeaders = names.map((n) => `${n}:${lowered.get(n)}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [method, canonicalUriFor(canonicalPath), query, canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");

  let key = hmac(`AWS4${credentials.secretAccessKey}`, dateStamp);
  key = hmac(key, region);
  key = hmac(key, service);
  key = hmac(key, "aws4_request");
  const signature = hmac(key, stringToSign).toString("hex");

  signed.authorization =
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return signed;
}

function parseIni(text) {
  const out = {};
  let section = "default";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) {
      section = sec[1].replace(/^profile\s+/, "");
      out[section] ??= {};
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[section] ??= {};
    out[section][line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

const readIni = (p) => {
  try {
    return parseIni(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
};

/** Resolve AWS credentials + region from env, then the shared config files. */
export function resolveAws(profile = process.env.AWS_PROFILE || "default") {
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    return {
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      },
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
      source: "env",
    };
  }
  const home = os.homedir();
  const creds = readIni(path.join(home, ".aws", "credentials"))[profile] ?? {};
  const conf = readIni(path.join(home, ".aws", "config"))[profile] ?? {};
  if (!creds.aws_access_key_id) return null;
  return {
    credentials: {
      accessKeyId: creds.aws_access_key_id,
      secretAccessKey: creds.aws_secret_access_key,
      sessionToken: creds.aws_session_token,
    },
    region: process.env.AWS_REGION || conf.region || "us-east-1",
    source: `profile:${profile}`,
  };
}
