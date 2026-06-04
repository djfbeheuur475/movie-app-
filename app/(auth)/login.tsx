import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleEmailAuth = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter your email and password.');
      return;
    }
    setIsLoading(true);
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        Alert.alert('Check your email', 'We sent you a confirmation link.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e: any) {
      Alert.alert('Auth error', e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGuestMode = () => {
    router.replace('/(tabs)');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Background gradient */}
      <LinearGradient
        colors={['#1a0000', Colors.background]}
        style={StyleSheet.absoluteFill}
      />

      {/* Logo area */}
      <View style={styles.logoArea}>
        <Text style={styles.logoText}>CINE</Text>
        <Text style={styles.logoAccent}>AI</Text>
        <Text style={styles.logoTagline}>Discover. Track. Experience.</Text>
      </View>

      {/* Form */}
      <View style={styles.form}>
        <Text style={styles.formTitle}>{isSignUp ? 'Create Account' : 'Welcome Back'}</Text>

        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor={Colors.textMuted}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          selectionColor={Colors.primary}
        />
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor={Colors.textMuted}
          secureTextEntry
          selectionColor={Colors.primary}
        />

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={handleEmailAuth}
          disabled={isLoading}
          activeOpacity={0.8}
        >
          {isLoading ? (
            <ActivityIndicator color={Colors.text} />
          ) : (
            <Text style={styles.primaryBtnText}>{isSignUp ? 'Create Account' : 'Sign In'}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.toggleMode}
          onPress={() => setIsSignUp((v) => !v)}
        >
          <Text style={styles.toggleText}>
            {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
          </Text>
        </TouchableOpacity>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity
          style={styles.guestBtn}
          onPress={handleGuestMode}
          activeOpacity={0.8}
        >
          <Text style={styles.guestBtnText}>Continue without account</Text>
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          By continuing you agree to our Terms of Service and Privacy Policy.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  logoArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 0,
  },
  logoText: {
    fontSize: 52,
    fontWeight: '900',
    color: Colors.text,
    letterSpacing: -2,
  },
  logoAccent: {
    fontSize: 52,
    fontWeight: '900',
    color: Colors.primary,
    letterSpacing: -2,
  },
  logoTagline: {
    ...Typography.caption,
    color: Colors.textMuted,
    width: '100%',
    textAlign: 'center',
    marginTop: -8,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  form: {
    padding: Spacing.xl,
    paddingBottom: 40,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: Colors.border,
  },
  formTitle: {
    ...Typography.heading,
    color: Colors.text,
    marginBottom: Spacing.xl,
  },
  input: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    color: Colors.text,
    ...Typography.body,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    height: 50,
  },
  primaryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  primaryBtnText: {
    ...Typography.subheading,
    color: Colors.text,
  },
  toggleMode: {
    marginTop: Spacing.md,
    alignItems: 'center',
  },
  toggleText: {
    ...Typography.body,
    color: Colors.primary,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: Spacing.xl,
    gap: Spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.border,
  },
  dividerText: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
  guestBtn: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guestBtnText: {
    ...Typography.subheading,
    color: Colors.textSecondary,
  },
  disclaimer: {
    ...Typography.caption,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.lg,
    lineHeight: 18,
  },
});
