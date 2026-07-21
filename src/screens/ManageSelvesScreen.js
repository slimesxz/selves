// src/screens/ManageSelvesScreen.js
import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { colors } from "../theme/colors";
import { ensureAuthenticated } from "../services/auth";
import { getProfiles, getActiveProfileId, setActiveProfileId } from "../services/selves";

export default function ManageSelvesScreen({ navigation }) {
  const [uid, setUid] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [activeProfile, setActiveProfile] = useState(null);

  const refresh = async (userId) => {
    const list = await getProfiles(userId);
    const a = await getActiveProfileId();

    setProfiles(list);
    setActiveId(a);

    const found = list.find((p) => p.id === a) ?? null;
    setActiveProfile(found);
  };

  useEffect(() => {
    const run = async () => {
      try {
        const user = await ensureAuthenticated();
        setUid(user.uid);
        await refresh(user.uid);
      } catch (e) {
        Alert.alert("Error", e?.message ?? String(e));
      }
    };

    run();

    const unsub = navigation.addListener("focus", run);
    return unsub;
  }, [navigation]);

  const switchProfile = async (profileId) => {
    try {
      await setActiveProfileId(profileId);
      setActiveId(profileId);
      const found = profiles.find((p) => p.id === profileId) ?? null;
      setActiveProfile(found);
    } catch (e) {
      Alert.alert("Error", e?.message ?? String(e));
    }
  };

  const goPlaceholder = (label) => {
    Alert.alert(label, "Placeholder screen.");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{activeProfile?.name ?? "Self"}</Text>
      <Text style={styles.subtle}>Active</Text>

      {/* Quick switch (optional, but useful) */}
      <View style={styles.list}>
        {profiles.map((p) => {
          const isActive = p.id === activeId;
          return (
            <TouchableOpacity
              key={p.id}
              style={[styles.row, isActive && styles.rowActive]}
              onPress={() => switchProfile(p.id)}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{p.name}</Text>
              </View>
              <Text style={styles.rowTag}>{isActive ? "ACTIVE" : "TAP"}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Primary actions inside a Self (placeholders for now) */}
      <View style={styles.form}>
        <TouchableOpacity style={styles.button} onPress={() => goPlaceholder("Ritual")} activeOpacity={0.85}>
          <Text style={styles.buttonText}>Ritual</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={() => goPlaceholder("Log")} activeOpacity={0.85}>
          <Text style={styles.buttonText}>Log</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={() => goPlaceholder("Insights")} activeOpacity={0.85}>
          <Text style={styles.buttonText}>Insights</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.buttonGhost}
          onPress={() => navigation.reset({ index: 0, routes: [{ name: "Home" }] })}
          activeOpacity={0.85}
        >
          <Text style={styles.buttonGhostText}>Back to Selves</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.black, padding: 24, paddingTop: 70 },
  title: { color: colors.white, fontSize: 28, fontWeight: "600", marginBottom: 6 },
  subtle: { color: colors.gray, marginBottom: 18 },

  list: { gap: 10, marginBottom: 22 },
  row: {
    borderWidth: 1,
    borderColor: colors.darkGray ?? "#333",
    borderRadius: 10,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowActive: { borderColor: colors.white },
  rowTitle: { color: colors.white, fontSize: 16, fontWeight: "600" },
  rowTag: { color: colors.gray, fontSize: 12 },

  form: { gap: 10 },
  button: {
    backgroundColor: colors.white,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 6,
  },
  buttonText: { color: colors.black, fontWeight: "600" },

  buttonGhost: {
    borderWidth: 1,
    borderColor: colors.darkGray ?? "#333",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 6,
  },
  buttonGhostText: { color: colors.white, fontWeight: "600" },
});