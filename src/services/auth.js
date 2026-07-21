import { signInAnonymously } from "firebase/auth";
import { auth } from "./firebase.js";

export async function ensureAuthenticated() {
  if (auth.currentUser) return auth.currentUser;
  const cred = await signInAnonymously(auth);
  return cred.user;
}