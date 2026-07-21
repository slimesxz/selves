// src/services/selves.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import { db } from "./firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
} from "firebase/firestore";

const ACTIVE_SELF_KEY = "activeSelfId";
const MAX_SELVES = 3;

const normalize = (s) => (s ?? "").trim().toLowerCase();

// --- Internal helpers ---
async function fetchAllSelves(uid) {
  const ref = collection(db, "users", uid, "selves");
  const q = query(ref, orderBy("createdAt", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function assertUniqueHandle(uid, handleRaw, exceptSelfId = null) {
  const wanted = normalize(handleRaw);
  if (!wanted) throw new Error("Name required.");

  const all = await fetchAllSelves(uid);
  const dup = all.find((s) => {
    if (exceptSelfId && s.id === exceptSelfId) return false;
    return normalize(s.handle) === wanted;
  });

  if (dup) throw new Error("That name is already taken.");
}

function coerceHandle(input) {
  // Accept either {handle} or {name} patterns safely.
  if (typeof input === "string") return input;
  const maybe = input?.handle ?? input?.name ?? "";
  return maybe;
}

// --- Public API ---

export async function listSelves(uid) {
  if (!uid) throw new Error("Missing uid.");
  return await fetchAllSelves(uid);
}

export async function createSelf(uid, data) {
  if (!uid) throw new Error("Missing uid.");

  const handle = coerceHandle(data);
  const bio = typeof data === "object" ? (data?.bio ?? "") : "";

  const h = (handle ?? "").trim();
  if (!h) throw new Error("Name required.");

  const existing = await fetchAllSelves(uid);
  if (existing.length >= MAX_SELVES) throw new Error("Max 3 Selves.");

  await assertUniqueHandle(uid, h);

  const ref = collection(db, "users", uid, "selves");
  const docRef = await addDoc(ref, {
    handle: h,
    bio: (bio ?? "").trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // If no active self yet, set it.
  const active = await AsyncStorage.getItem(ACTIVE_SELF_KEY);
  if (!active) {
    await AsyncStorage.setItem(ACTIVE_SELF_KEY, docRef.id);
  }

  return docRef.id;
}

export async function renameSelf(uid, selfId, newHandleRaw) {
  if (!uid) throw new Error("Missing uid.");
  if (!selfId) throw new Error("Missing selfId.");

  const newHandle = (newHandleRaw ?? "").trim();
  if (!newHandle) throw new Error("Name required.");

  await assertUniqueHandle(uid, newHandle, selfId);

  const ref = doc(db, "users", uid, "selves", selfId);
  await updateDoc(ref, {
    handle: newHandle,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteSelf(uid, selfId) {
  if (!uid) throw new Error("Missing uid.");
  if (!selfId) throw new Error("Missing selfId.");

  const all = await fetchAllSelves(uid);
  if (all.length <= 1) throw new Error("You need at least one Self.");

  const ref = doc(db, "users", uid, "selves", selfId);
  await deleteDoc(ref);

  const active = await AsyncStorage.getItem(ACTIVE_SELF_KEY);
  if (active === selfId) {
    await AsyncStorage.removeItem(ACTIVE_SELF_KEY);
  }
}

export async function getActiveSelfId() {
  return await AsyncStorage.getItem(ACTIVE_SELF_KEY);
}

export async function setActiveSelf(uid, selfId) {
  if (!selfId) throw new Error("Missing selfId.");

  // Optional safety: verify self exists.
  if (uid) {
    const ref = doc(db, "users", uid, "selves", selfId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error("Self not found.");
  }

  await AsyncStorage.setItem(ACTIVE_SELF_KEY, selfId);
  return selfId;
}

// --- Back-compat exports (so older screens don't break) ---
export async function getProfiles(uid) {
  return await listSelves(uid);
}

export async function createProfile(uid, data) {
  // Allow screens to call createProfile(uid, {name}) or createProfile(uid, {handle})
  return await createSelf(uid, data);
}

export async function getActiveProfileId() {
  return await getActiveSelfId();
}

export async function setActiveProfileId(id) {
  return await setActiveSelf(null, id);
}

// --- Optional user-level doc (Onboarding) ---
export async function saveUserProfile(uid, { handle, name, bio = "" }) {
  if (!uid) throw new Error("Missing uid.");

  const h = (handle ?? name ?? "").trim();
  if (!h) throw new Error("Name required.");

  // Enforce uniqueness across selves too (matches your "never same name" rule)
  await assertUniqueHandle(uid, h);

  const userRef = doc(db, "users", uid);
  await setDoc(
    userRef,
    {
      handle: h,
      bio: (bio ?? "").trim(),
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );

  // Ensure at least one self exists
  const all = await fetchAllSelves(uid);
  if (all.length === 0) {
    await createSelf(uid, { handle: h, bio });
  }
}