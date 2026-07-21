// src/screens/OnboardingScreen.js
import React, { useRef, useState } from "react";
import {
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { ensureAuthenticated } from "../services/auth";
import { saveUserProfile } from "../services/selves";
import { colors } from "../theme/colors";

export default function OnboardingScreen({ navigation }) {
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);

  const goNextAfterProfile = async () => {
    try {
      const seen = await AsyncStorage.getItem("tutorialSeen");
      navigation.reset({
        index: 0,
        routes: [{ name: seen === "1" ? "Home" : "Tutorial" }],
      });
    } catch {
      navigation.reset({ index: 0, routes: [{ name: "Tutorial" }] });
    }
  };

  const handleContinue = async () => {
    // normalize: strip leading @, trim
    const h = (handle ?? "").trim().replace(/^@+/, "");

    if (!h) {
      Alert.alert("Handle required", "Please enter a handle.");
      return;
    }

    if (loading || submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);

    try {
      const user = await ensureAuthenticated();

      // This should create ONE self (if none exists) and enforce uniqueness rules in services/selves.js
      await saveUserProfile(user.uid, {
        handle: h,
        bio: (bio ?? "").trim(),
      });

      await goNextAfterProfile();
    } catch (e) {
      Alert.alert("Error", e?.message ?? String(e));
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const canSubmit = (handle ?? "").trim().replace(/^@+/, "").length > 0;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Text style={styles.title}>Create your handle</Text>

      <TextInput
  style={styles.input}
  placeholder="@yourname"
  placeholderTextColor={colors.gray}
  selectionColor={colors.white}
  value={handle}
  onChangeText={setHandle}
  autoCapitalize="none"
  autoCorrect={false}
/>

<TextInput
  style={[styles.input, styles.bio]}
  placeholder="Bio (optional)"
  placeholderTextColor={colors.gray}
  selectionColor={colors.white}
  value={bio}
  onChangeText={setBio}
  multiline
/>

      <TouchableOpacity
        style={[
          styles.button,
          (loading || !canSubmit) && styles.buttonDisabled,
        ]}
        onPress={handleContinue}
        disabled={loading || !canSubmit}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>
          {loading ? "Saving..." : "Continue"}
        </Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.black,
    padding: 24,
    justifyContent: "center",
  },
  title: {
    color: colors.white,
    fontSize: 28,
    fontWeight: "600",
    marginBottom: 24,
    textAlign: "center",
  },
  input: {
    borderBottomWidth: 1,
    borderBottomColor: colors.gray,
    color: colors.white,
    paddingVertical: 12,
    marginBottom: 18,
    fontSize: 16,
  },
  bio: {
    minHeight: 72,
  },
  button: {
    marginTop: 10,
    backgroundColor: colors.white,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: colors.black,
    fontSize: 16,
    fontWeight: "600",
  },
});