import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";

let app: App | undefined;

function getFirebaseAdmin(): App {
  if (app) return app;

  const existing = getApps();
  if (existing.length > 0) {
    app = existing[0];
    return app;
  }

  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccount) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY env var is required");
  }

  app = initializeApp({
    credential: cert(JSON.parse(serviceAccount)),
  });

  return app;
}

export function getAdminAuth(): Auth {
  return getAuth(getFirebaseAdmin());
}
