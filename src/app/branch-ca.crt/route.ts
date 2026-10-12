import { caDir, readRootCert } from '@/lib/branch-ca';

export async function GET() {
  const pem = await readRootCert();
  if (pem) {
    return new Response(new Uint8Array(pem), {
      headers: { 'Content-Type': 'application/x-x509-ca-cert', 'Cache-Control': 'no-store' },
    });
  }
  console.error(`branch-ca.crt: no root.crt in ${caDir()}. Start Caddy once, or set CADDY_CA_DIR.`);
  return new Response(
    'The branch certificate is not ready yet. Ask the office to start the secure connection (Caddy) on the office computer, then try again.',
    { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
