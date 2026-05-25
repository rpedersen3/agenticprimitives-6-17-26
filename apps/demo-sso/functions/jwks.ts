// GET /jwks — the broker's public JWKS. Relying sites fetch this to verify the
// AgentSession (asymmetric; the private key never leaves the server).
import { getServer, json, type FnContext } from './_lib/server-broker';

export const onRequestGet = async ({ env }: FnContext): Promise<Response> => {
  const { jwks } = await getServer(env);
  return json(jwks);
};
