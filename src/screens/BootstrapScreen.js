// src/screens/BootstrapScreen.js
import React, { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors } from "../theme/colors";

import { ensureAuthenticated } from "../services/auth";
import { listSelves } from "../services/selves";

export default function BootstrapScreen({ navigation }) {
  useEffect(() => {
    (async () => {
      try {
        const user = await ensureAuthenticated();
        const selves = await listSelves(user.uid);
        const seen = await AsyncStorage.getItem("tutorialSeen");

        if (!selves || selves.length === 0) {
          navigation.reset({ index: 0, routes: [{ name: "Onboarding" }] });
          return;
        }

        if (seen !== "1") {
          navigation.reset({ index: 0, routes: [{ name: "Tutorial" }] });
          return;
        }

        navigation.reset({ index: 0, routes: [{ name: "Home" }] });
      } catch {
        // If anything fails, safest is Onboarding
        navigation.reset({ index: 0, routes: [{ name: "Onboarding" }] });
      }
    })();
  }, [navigation]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.black, justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  );
}