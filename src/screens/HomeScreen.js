// src/screens/HomeScreen.js
import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { colors } from "../theme/colors";
import { ensureAuthenticated } from "../services/auth";
import { listSelves, getActiveSelfId, setActiveSelf } from "../services/selves";

export default function HomeScreen({ navigation }) {
  const [activeHandle, setActiveHandle] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const user = await ensureAuthenticated();
        const selves = await listSelves(user.uid);
        const activeId = await getActiveSelfId();

        // If no active self set yet, set first one.
        if (!activeId && selves.length > 0) {
          await setActiveSelf(user.uid, selves[0].id);
          setActiveHandle(selves[0].handle ?? "");
          return;
        }

        const active = selves.find((s) => s.id === activeId) ?? selves[0];
        setActiveHandle(active?.handle ?? "");
      } catch {
        setActiveHandle("");
      }
    })();
  }, []);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.black,
        justifyContent: "center",
        alignItems: "center",
        padding: 24,
        gap: 12,
      }}
    >
      <Text style={{ color: colors.white, fontSize: 18 }}>
        Home {activeHandle ? `— @${activeHandle}` : ""}
      </Text>

      <TouchableOpacity
        onPress={() => navigation.navigate("ManageSelves")}
        activeOpacity={0.85}
        style={{
          backgroundColor: colors.white,
          paddingVertical: 14,
          paddingHorizontal: 18,
          borderRadius: 10,
        }}
      >
        <Text style={{ color: colors.black, fontWeight: "600" }}>
          Manage Selves
        </Text>
      </TouchableOpacity>
    </View>
  );
}