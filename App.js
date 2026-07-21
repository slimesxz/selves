// App.js (PROJECT ROOT)
import { NavigationContainer } from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";

import BootstrapScreen from "./src/screens/BootstrapScreen";
import OnboardingScreen from "./src/screens/OnboardingScreen";
import TutorialScreen from "./src/screens/TutorialScreen";
import HomeScreen from "./src/screens/HomeScreen";
import ManageSelvesScreen from "./src/screens/ManageSelvesScreen";

const Stack = createStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Bootstrap" component={BootstrapScreen} />
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        <Stack.Screen name="Tutorial" component={TutorialScreen} />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="ManageSelves" component={ManageSelvesScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}