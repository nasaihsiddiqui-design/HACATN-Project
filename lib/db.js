import { MongoClient } from 'mongodb';

export async function db() {
  if (!globalThis._hcmClient) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not set');
    globalThis._hcmClient = new MongoClient(uri).connect();
  }
  const c = await globalThis._hcmClient;
  return c.db(process.env.MONGODB_DB || 'hcm_lite');
}
