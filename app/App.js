import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { supabase } from "./supabaseClient";

export default function App() {
  const [session, setSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoadingSession(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  if (loadingSession) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return session ? <WorkoutsScreen session={session} /> : <AuthScreen />;
}

function AuthScreen() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email || !password) return;

    setBusy(true);
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) Alert.alert(error.message);
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) Alert.alert(error.message);
      else setMode("login");
    }
    setBusy(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Workout Planner 💪</Text>

      <View style={styles.card}>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          autoCapitalize="none"
          style={styles.input}
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          secureTextEntry
          style={styles.input}
        />

        <Pressable style={styles.button} onPress={submit} disabled={busy}>
          <Text style={styles.buttonText}>
            {mode === "login" ? "Login" : "Register"}
          </Text>
        </Pressable>

        <Pressable onPress={() => setMode(mode === "login" ? "register" : "login")}>
          <Text style={styles.link}>
            {mode === "login" ? "Create account" : "Go to login"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function WorkoutsScreen({ session }) {
  const user = session.user;
  const [workouts, setWorkouts] = useState([]);
  const [name, setName] = useState("");
  const [planText, setPlanText] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);

  const plan = useMemo(
    () => planText.split("\n").map((l) => l.trim()).filter(Boolean),
    [planText]
  );

  const load = async () => {
    const { data } = await supabase
      .from("workouts")
      .select("*")
      .order("created_at", { ascending: false });
    setWorkouts(data || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!name || plan.length === 0) return;

    if (editingId) {
      await supabase.from("workouts").update({ name, plan }).eq("id", editingId);
    } else {
      await supabase.from("workouts").insert({
        name,
        plan,
        user_id: user.id,
      });
    }

    setName("");
    setPlanText("");
    setEditingId(null);
    load();
  };

  const edit = (w) => {
    setEditingId(w.id);
    setName(w.name);
    setPlanText(w.plan.join("\n"));
  };

  const remove = async (id) => {
    await supabase.from("workouts").delete().eq("id", id);
    load();
  };

  const logout = async () => {
    await supabase.auth.signOut();
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Workouts</Text>

      <View style={styles.card}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Workout name"
          style={styles.input}
        />
        <TextInput
          value={planText}
          onChangeText={setPlanText}
          placeholder="Plan (one per line)"
          multiline
          style={[styles.input, { height: 80 }]}
        />
        <Pressable style={styles.button} onPress={save}>
          <Text style={styles.buttonText}>
            {editingId ? "Update" : "Add"}
          </Text>
        </Pressable>
      </View>

      <FlatList
        data={workouts}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <View style={styles.listItem}>
            <Text style={{ fontWeight: "700" }}>{item.name}</Text>
            <Text>{item.plan.join(", ")}</Text>
            <View style={{ flexDirection: "row", marginTop: 6 }}>
              <Pressable onPress={() => edit(item)}>
                <Text style={styles.link}>Edit</Text>
              </Pressable>
              <Pressable onPress={() => remove(item.id)}>
                <Text style={[styles.link, { color: "red", marginLeft: 12 }]}>
                  Delete
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      />

      <Pressable onPress={logout}>
        <Text style={[styles.link, { textAlign: "center", marginTop: 10 }]}>
          Logout
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { flex: 1, padding: 16, backgroundColor: "#f4f5f7" },
  title: { fontSize: 26, fontWeight: "800", textAlign: "center", marginBottom: 16 },
  card: {
    backgroundColor: "#fff",
    padding: 14,
    borderRadius: 12,
    marginBottom: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    backgroundColor: "#fff",
  },
  button: {
    backgroundColor: "#111827",
    padding: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontWeight: "700" },
  link: { color: "#2563eb", fontWeight: "600", marginTop: 8 },
  listItem: {
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
  },
});
