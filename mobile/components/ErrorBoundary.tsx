import { Component, ReactNode } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Platform,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Sentry, sentryEnabled } from '../lib/sentry'

interface Props { children: ReactNode }
interface State { error: Error | null; info: string }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Log full details only in development - production logs are world-readable on Android
    if (__DEV__) {
      console.error('[ErrorBoundary] Caught error:', error.message)
      console.error('[ErrorBoundary] Stack:', info.componentStack)
    }
    // Report React render errors to Sentry (no-op when Sentry has no DSN).
    if (sentryEnabled) {
      Sentry.captureException(error, {
        contexts: { react: { componentStack: info.componentStack } },
      })
    }
    this.setState({ info: __DEV__ ? (info.componentStack ?? '') : '' })
  }

  reset = () => this.setState({ error: null, info: '' })

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children

    return (
      <View style={styles.container}>
        <View style={styles.iconWrap}>
          <Ionicons name="warning-outline" size={48} color="#dc2626" />
        </View>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.message}>{error.message}</Text>

        {__DEV__ && (
          <ScrollView style={styles.stack} showsVerticalScrollIndicator={false}>
            <Text style={styles.stackText} selectable>
              {error.stack ?? ''}{info ? `\n\nComponent stack:\n${info}` : ''}
            </Text>
          </ScrollView>
        )}

        <TouchableOpacity style={styles.btn} onPress={this.reset} activeOpacity={0.8}>
          <Ionicons name="refresh-outline" size={18} color="#fff" />
          <Text style={styles.btnText}>Try again</Text>
        </TouchableOpacity>

        <Text style={styles.hint}>
          {Platform.OS === 'android' ? 'Shake device for dev menu.' : 'Shake for dev menu.'}
          {'\n'}Screenshot this and report to support.
        </Text>
      </View>
    )
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fef2f2',
    padding: 24,
    paddingTop: 64,
    alignItems: 'center',
  },
  iconWrap: { marginBottom: 16 },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#7f1d1d',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: '#991b1b',
    textAlign: 'center',
    marginBottom: 16,
    fontWeight: '500',
  },
  stack: {
    flex: 1,
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  stackText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    color: '#374151',
    lineHeight: 16,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#dc2626',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  hint: {
    fontSize: 11,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 16,
  },
})
