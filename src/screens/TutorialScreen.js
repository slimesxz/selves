// src/screens/TutorialScreen.js
import React, { useRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import PagerView from "react-native-pager-view";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors } from "../theme/colors";

const slides = [
  { title: "Attention", text: "Selves is a space for intentional presence." },
  { title: "Profiles", text: "Start with one Self. You can add up to three later." },
  { title: "Ritual", text: "Your actions shape the system. Nothing is passive." },
];

export default function TutorialScreen({ navigation }) {
  const finishedRef = useRef(false);

  const finishTutorial = async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;

    try {
      await AsyncStorage.setItem("tutorialSeen", "1");
    } catch (e) {
      // If storage fails, still allow the user forward.
      // We still navigate to Home so onboarding isn’t blocked.
    }

    navigation.reset({ index: 0, routes: [{ name: "Home" }] });
  };

  return (
    <PagerView
      style={styles.container}
      initialPage={0}
      onPageSelected={(e) => {
        const i = e.nativeEvent.position;
        if (i === slides.length) finishTutorial();
      }}
    >
      {slides.map((s, i) => (
        <View key={String(i)} style={styles.page}>
          <Text style={styles.title}>{s.title}</Text>
          <Text style={styles.text}>{s.text}</Text>
        </View>
      ))}

      {/* Final invisible page triggers completion */}
      <View key="done" />
    </PagerView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.black },
  page: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  title: {
    color: colors.white,
    fontSize: 28,
    fontWeight: "600",
    marginBottom: 12,
  },
  text: {
    color: colors.gray,
    fontSize: 16,
    textAlign: "center",
    maxWidth: 280,
  },
});