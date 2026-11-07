// Derives stable secrets from the Cloudflare API token (already a repo secret), so no extra
// secrets are needed: a pipeline->worker auth token and the VAPID key pair for web push.
import crypto from "node:crypto";

export function deriveKeys(cfToken) {
  if (!cfToken) return null;
  const pipelineToken = crypto.createHmac("sha256", cfToken).update("shopping-pipeline-token").digest("hex");
  const n = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
  const seed = BigInt("0x" + crypto.createHmac("sha256", cfToken).update("shopping-vapid-key").digest("hex"));
  const d = (seed % (n - 1n)) + 1n;
  const priv = Buffer.from(d.toString(16).padStart(64, "0"), "hex");
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(priv);
  const b64u = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { pipelineToken, vapidPrivate: b64u(priv), vapidPublic: b64u(ecdh.getPublicKey()) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const k = deriveKeys(process.env.CLOUDFLARE_API_TOKEN || "");
  const what = process.argv[2];
  if (!k) process.exit(0);
  if (what) process.stdout.write(k[what]);
  else process.stdout.write(JSON.stringify({ vapidPublic: k.vapidPublic }));
}
