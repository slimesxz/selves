import { initializeApp } from "firebase/app";
import {
  initializeAuth,
  getReactNativePersistence,
} from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCLqyvlivYsY4VSREEvIIlBYphHc23fqxc",
  authDomain: "selves-99.firebaseapp.com",
  projectId: "selves-99",
  storageBucket: "selves-99.firebasestorage.app",
  messagingSenderId: "697466783905",
  appId: "1:697466783905:web:7f491e3068811ddfa4c8e0",
  measurementId: "G-5EDB53KZFH"
};

const app = initializeApp(firebaseConfig);

export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

export const db = getFirestore(app);