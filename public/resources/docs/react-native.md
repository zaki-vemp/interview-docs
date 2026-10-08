# React Native

Your MeetHour work includes **React Native** (the mobile conferencing app). Interviewers will check that you understand **how RN differs from the web**, the **New Architecture**, performance on lists and animations, native modules, and mobile-specific concerns such as **permissions, background audio and calls**.

## Architecture

### How does React Native work? 🔥

- You write React components with JavaScript/TypeScript. RN renders **real native views** (`UIView` on iOS, `android.view.View` on Android), **not** a WebView.
- **Threads:**
  - the **JS thread** runs your React code (the Hermes engine)
  - the **UI/main thread** renders native views and handles touches
  - a **background thread** computes layout with **Yoga** (a Flexbox implementation in C++)
- React's reconciler computes changes, and the **renderer** applies them to the native view hierarchy.
- **Native capabilities** (camera, Bluetooth, WebRTC) are exposed through **native modules**.

### Old architecture (Bridge) vs New Architecture (JSI, Fabric, TurboModules) 🔥

**Old architecture:**

- All communication between JS and native went through the **asynchronous Bridge**: messages **serialised to JSON**, batched and queued.
- Problems:
  - serialisation overhead
  - **no synchronous calls** (layout measurement needed async round trips)
  - congestion with high-frequency events (scroll, gestures, video stats)
  - all native modules **initialised at startup**

**New Architecture** (the **default since RN 0.76**; the legacy architecture has since been frozen and removed in newer releases):

| Piece | What it does |
|---|---|
| **JSI** (JavaScript Interface) | A C++ API that lets JS hold **direct references to C++ host objects** and call them **synchronously**, with no JSON serialisation. The foundation of everything else |
| **TurboModules** | Native modules built on JSI, **lazily loaded** (faster startup), type-safe via **Codegen** |
| **Fabric** | The new **renderer**: a C++ shadow tree shared across platforms, **synchronous layout** when needed, supports **React 18 concurrent features** (transitions, Suspense), better interop with native views |
| **Codegen** | Generates native interfaces (C++/ObjC/Java/Kotlin) from **typed JS/TS specs**, ensuring JS and native agree on types |
| **Bridgeless mode** | Removes the legacy bridge entirely |

**Why it matters for a conferencing app:**

- lower latency for high-frequency native events (audio levels, stats)
- synchronous measurements for overlays
- concurrent rendering, so the UI stays responsive during heavy updates

### What is Hermes and why is it the default engine?

**Hermes** is a JavaScript engine **optimised for React Native** (the default since RN 0.70).

- It **precompiles JS to bytecode at build time**, so there's no parse or compile at app launch. That means **faster startup (TTI)**, **lower memory**, and smaller downloads with compressed bytecode.
- Its garbage collector is tuned for mobile.
- It supports debugging through **React Native DevTools** (Chrome DevTools frontend) and the sampling profiler.
- **Trade-offs:** historically some newer JS features lagged behind V8/JSC (Intl and Proxy support have improved). The **"Static Hermes"** effort aims for ahead-of-time native compilation.

### Expo vs bare React Native: which do you choose?

- **Expo** is a framework and platform on top of RN. It's **recommended by the React Native team** for new apps.
  - **Expo SDK modules** (camera, notifications, file system, secure store)
  - **Expo Router** (file-based routing, like Next.js)
  - **EAS Build/Submit/Update**: cloud builds, store submission, **over-the-air JS updates**
  - **Config plugins** to modify native projects without ejecting
  - **development builds** for custom native code
- **Bare RN** (the `react-native` CLI) gives full manual control of the `ios/` and `android/` projects. It was needed historically for heavy native integrations, but today Expo with development builds and **prebuild** (Continuous Native Generation) handles nearly everything, including WebRTC via config plugins.
- **For a WebRTC app:** `react-native-webrtc` (or the Jitsi Meet RN SDK) works with Expo **development builds** plus a config plugin. It **doesn't** work in **Expo Go**, which only includes Expo's native modules.

## UI & performance

### How is React Native different from React for the web? 🔥

| Web | React Native |
|---|---|
| `<div>`, `<span>`, `<img>`, `<input>` | `<View>`, `<Text>` (**all text must be inside `<Text>`**), `<Image>`, `<TextInput>`, `<Pressable>` |
| CSS files, cascade, selectors | **`StyleSheet.create`** JS objects, **no cascade** (only `Text` inherits from parent `Text`), no selectors, units are density-independent pixels |
| Flexbox default `row` | Flexbox default **`flexDirection: 'column'`**; `flex: 1` semantics differ slightly |
| Scrolling is automatic | Use **`ScrollView`** or virtualised lists (`FlatList`/`SectionList`/FlashList) |
| `onClick` | `onPress` via `Pressable`/`TouchableOpacity`; gesture system (react-native-gesture-handler) |
| URL routing | Stack/tab navigators (React Navigation, Expo Router) |
| Browser APIs | Native modules (camera, storage, sensors); `fetch` and WebSocket exist |
| Deploy instantly | App Store / Play Store review; **OTA updates** only for JS/asset changes |

### FlatList vs ScrollView, and how do you optimise long lists? 🔥

- **`ScrollView`** renders **all children at once**. Use it only for short, bounded content.
- **`FlatList`/`SectionList`** **virtualise**: they render only items near the viewport (`VirtualizedList`) and unmount far-away items.

**FlatList optimisations:**

- `keyExtractor` with stable IDs.
- **`getItemLayout`** for fixed-height rows. It skips measurement, enables `scrollToIndex`, and makes scrolling much smoother.
- Tune `initialNumToRender`, `maxToRenderPerBatch`, `windowSize` (default 21 screens) and `updateCellsBatchingPeriod`.
- `removeClippedSubviews` on Android.
- **Memoise row components** (`React.memo`) and keep `renderItem` stable (`useCallback`). Avoid inline objects and functions in rows.
- Use lightweight rows, optimised images (expo-image/FastImage with caching), and avoid heavy shadows on Android.
- **FlashList** (Shopify) **recycles views** instead of mounting and unmounting cells, which is much faster for large lists. v2 is built for the New Architecture.

```jsx
const ParticipantRow = memo(function ParticipantRow({ item, onPress }) {
  return (
    <Pressable onPress={() => onPress(item.id)} style={styles.row}>
      <Text style={styles.name}>{item.name}</Text>
      {item.muted && <MicOffIcon />}
    </Pressable>
  );
});

function ParticipantList({ participants, onSelect }) {
  const renderItem = useCallback(({ item }) => <ParticipantRow item={item} onPress={onSelect} />, [onSelect]);
  return (
    <FlatList
      data={participants}
      keyExtractor={(p) => p.id}
      renderItem={renderItem}
      getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
      initialNumToRender={15}
      windowSize={7}
    />
  );
}
```

### How do you build smooth 60/120 fps animations in React Native? 🔥

- **The problem:** animations driven from the JS thread stutter when JS is busy (rendering, parsing data).
- **`Animated` with `useNativeDriver: true`:** the animation is serialised once and runs **on the UI thread**. It's limited to non-layout properties (transform, opacity).
- **Reanimated** (v3/v4):
  - animations and gesture handlers run as **worklets on the UI thread**
  - **shared values** (`useSharedValue`) and `useAnimatedStyle`
  - works with **react-native-gesture-handler** for drag/pinch/swipe that stays smooth even if JS is blocked
  - layout animations
- **Avoid animating layout** (width/height) where possible; animate transforms.
- **`InteractionManager.runAfterInteractions`** defers heavy work until animations and transitions finish.
- For a conferencing UI (draggable self-view/PiP tile, swipe between pages), use **Reanimated + Gesture Handler**.

### What causes performance problems in RN apps and how do you profile them?

**Common causes:**

- unnecessary re-renders (the same React issues as on the web)
- heavy JS work on the JS thread (large JSON parsing, synchronous loops)
- un-virtualised lists
- big images without resizing or caching
- too many native views (deep hierarchies)
- old-architecture bridge congestion
- slow startup from eager imports

**Tools:**

- **React Native DevTools** (0.76+): React profiler, components, console, Hermes debugging
- the Perf Monitor overlay (JS and UI FPS)
- Hermes sampling profiler
- Android Studio Profiler / Xcode Instruments (CPU, memory, GPU overdraw)
- `why-did-you-render`
- Flipper is deprecated

**Startup optimisations:** Hermes, **lazy-loading screens** (`React.lazy` / inline `require`s), fewer native modules initialised at launch (TurboModules are lazy), and a smaller JS bundle.

## Native integration

### How do you write a native module (TurboModule) or use Expo Modules? 🔥

**TurboModule flow:**

1. Write a **typed spec** in TS: `export interface Spec extends TurboModule { getBatteryLevel(): Promise<number>; }` with `TurboModuleRegistry.getEnforcing<Spec>('Battery')`.
2. **Codegen** generates the native interfaces.
3. Implement them in **Kotlin/Java** (Android) and **Swift/Objective-C++** (iOS).
4. Calls go over **JSI** and can be **synchronous** for cheap reads.

**Expo Modules API:** write the module in **Swift and Kotlin** with a concise DSL (`Function("getBatteryLevel") { … }`, `Events(...)`, `View(...)`). It handles the boilerplate and works with the New Architecture.

**Native UI components:** Fabric components (or Expo `View` definitions) wrap native views, such as a native video renderer (`RTCView` in react-native-webrtc).

```tslib
// specs/NativeAudioRoute.ts — TurboModule spec (Codegen input)
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  getCurrentRoute(): string;                                      // synchronous via JSI
  setRoute(route: 'speaker' | 'earpiece' | 'bluetooth'): Promise<void>;
  addListener(eventName: string): void;                           // required for event emitters
  removeListeners(count: number): void;
}
export default TurboModuleRegistry.getEnforcing<Spec>('AudioRoute');
```


### How do you handle platform differences?

- **`Platform.OS === 'ios'`**, **`Platform.select({ ios: …, android: …, default: … })`**, `Platform.Version`.
- **Platform-specific files:** `Button.ios.tsx` / `Button.android.tsx`. Metro picks the right one automatically. `.native.tsx` vs `.web.tsx` for React Native Web.
- Differences to handle:
  - **permissions** flows (iOS asks once; Android has runtime permissions plus "don't ask again")
  - **back button** (Android hardware back via `BackHandler`)
  - safe areas (`react-native-safe-area-context`)
  - keyboard behaviour (`KeyboardAvoidingView` behaviour differs)
  - shadows (iOS `shadow*` vs Android `elevation`)
  - fonts and status bar

### How does WebRTC work in React Native (e.g. a MeetHour or Jitsi mobile app)? 🔥

- **`react-native-webrtc`** provides the WebRTC API (`RTCPeerConnection`, `mediaDevices.getUserMedia`, `MediaStream`) backed by the **native libwebrtc**, plus **`<RTCView streamURL={stream.toURL()} />`** to render video natively. lib-jitsi-meet runs in RN on top of it; the **Jitsi Meet SDK** packages the whole meeting app for embedding.
- **Permissions:**
  - **iOS:** `NSCameraUsageDescription` and `NSMicrophoneUsageDescription` in Info.plist
  - **Android:** `CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `BLUETOOTH_CONNECT` (Android 12+), and **`POST_NOTIFICATIONS`** (Android 13+), requested at runtime
- **Background and calls:**
  - **iOS:** the `audio` and `voip` **background modes** keep audio flowing. **CallKit** integrates with the native call UI (lock screen answer, audio session handling). **PushKit VoIP pushes** deliver incoming calls, and Apple **requires** you to report a CallKit call for every VoIP push.
  - **Android:** a **foreground service** (with the `microphone`/`camera`/`phoneCall` foreground-service types on Android 14+) and an ongoing notification keep the call alive. `ConnectionService` / Telecom integrates with the system call UI.
- **Audio routing:** speaker vs earpiece vs Bluetooth, handled natively (e.g. Jitsi's AudioMode module) with an **audio session category** of `PlayAndRecord` and voice-chat mode on iOS.
- **Screen sharing:**
  - **iOS** needs a **Broadcast Upload Extension (ReplayKit)**: a separate extension process that captures the screen and sends frames to the app through an App Group/socket.
  - **Android** uses **MediaProjection** with a foreground service of type `mediaProjection`.
- **Performance:** limit decoded remote videos (last-N), lower resolution on mobile, pause video when the app goes to the background (and tell the bridge), and watch battery and thermal state.

### How do push notifications and deep links work?

- **Push:** **APNs** (iOS) and **FCM** (Android, and optionally iOS through FCM). Typical libraries are `expo-notifications`, `@react-native-firebase/messaging` and Notifee for rich local notifications.
  - Handle **foreground, background and killed** states.
  - Handle the **device token lifecycle** (send it to the backend; refresh).
  - **Data vs notification messages.**
  - **VoIP pushes** (PushKit) for incoming calls on iOS.
- **Deep links:**
  - **custom URL schemes** (`meethour://meeting/123`)
  - **Universal Links** (iOS, via an `apple-app-site-association` file on your domain) and **Android App Links** (`assetlinks.json`) to open `https://` links in the app
  - React Navigation's `linking` config or Expo Router maps URLs to screens
  - handle the **cold start** case (`Linking.getInitialURL()`) as well as warm links

### How do over-the-air (OTA) updates work, and what are their limits?

- **OTA updates** ship new **JS bundles and assets** without a store release. Today that's **EAS Update**; Microsoft's App Center CodePush was retired in 2025.
- On launch (or on resume), the app checks for an update compatible with its **runtime version** (the native code fingerprint), downloads it, and applies it on the next launch or immediately.
- **Limits:**
  - **No native code changes.** New native modules or permissions need a store build.
  - Follow store policies: no fundamentally changing the app's purpose.
  - Use **staged rollouts and rollback**, plus monitoring.

### How do you store data securely on mobile?

- **Secrets and tokens** go in **Keychain (iOS) / Keystore-backed EncryptedSharedPreferences (Android)**: `expo-secure-store` or `react-native-keychain`. Optionally require biometrics.
- **Non-sensitive data:** AsyncStorage (simple, async), **MMKV** (very fast, synchronous via JSI, supports encryption), SQLite/WatermelonDB/op-sqlite for relational or offline data.
- **Network security:**
  - HTTPS only (ATS on iOS, `cleartextTrafficPermitted=false` on Android)
  - optional **certificate pinning** for high-security apps (with a rotation plan)
- **Code:** Hermes bytecode isn't encryption, so **never ship secrets in the bundle**. Use the backend for privileged operations. Enable ProGuard/R8 for native code and add jailbreak/root detection where required.

### How do you test React Native apps?

- **Unit/component:** **Jest** + **React Native Testing Library** (`render`, `screen.getByText`, `fireEvent.press`, `userEvent`). Mock native modules (`jest.mock('react-native-webrtc')`).
- **E2E:** **Detox** (gray-box, synchronises with the RN runtime; good for CI on simulators) or **Maestro** (YAML flows, easy to start with), or Appium.
- **Manual and device testing:** real devices for camera/mic/Bluetooth, low-end Android devices, poor networks (Network Link Conditioner), and OS-version matrices. Device farms such as BrowserStack and Firebase Test Lab.
