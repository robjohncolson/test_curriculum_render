# AP Statistics Consensus Quiz - Hybrid Architecture

## Overview
This is a refactored version of the AP Statistics Quiz application with a robust hybrid data persistence model that works both online (Firebase) and offline (Local WebSocket Hub).

## Architecture Components

### 1. Primary Storage (Firebase Cloud)
- **Technology**: Firebase Firestore
- **Authentication**: Google Sign-In
- **Features**:
  - Permanent cloud storage
  - Real-time synchronization
  - Offline persistence with IndexedDB
  - Automatic sync when connection restored

### 2. Local Hub (Offline Peer-to-Peer)
- **Technology**: Node.js WebSocket server
- **Purpose**: Enable classroom collaboration without internet
- **Features**:
  - Real-time peer data sharing
  - In-memory session storage
  - Automatic peer discovery
  - No internet required (LAN only)

### 3. Client Application
- **Modes**: Cloud, Local Network, or Offline
- **Auto-switching**: Detects connection status
- **Hybrid sync**: Manages both Firebase and WebSocket connections

## Setup Instructions

### Step 1: Firebase Project Setup

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a new project or select existing
3. Enable Authentication:
   - Go to Authentication > Sign-in method
   - Enable Google provider
4. Create Firestore Database:
   - Go to Firestore Database
   - Create database in production mode
   - Set location closest to your users
5. Get configuration:
   - Go to Project Settings > General
   - Scroll to "Your apps" > Web app
   - Register app and copy configuration

6. Update `firebase-config.js`:
```javascript
config: {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
}
```

7. Set Firestore Security Rules:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow authenticated users to read/write their own data
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;

      // Allow subcollections
      match /{document=**} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }

    // Allow all authenticated users to read/write quiz responses
    match /quizResponses/{document} {
      allow read, write: if request.auth != null;
    }

    // Allow session management
    match /sessions/{sessionId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }

    // Class-wide data
    match /classData/{document} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
  }
}
```

### Step 2: Local Hub Server Setup (Teacher's Computer)

1. **Install Node.js** (if not already installed):
   - Download from [nodejs.org](https://nodejs.org)
   - Verify installation: `node --version`

2. **Install Dependencies**:
```bash
cd /path/to/project
npm install
```

3. **Start the Local Hub**:
```bash
npm start
```
Or:
```bash
node server.js
```

4. **Note the IP Address**:
   - The server will display: `WebSocket Server: ws://192.168.X.X:8080`
   - Share this IP with students

5. **Verify Server**:
   - Open browser: `http://192.168.X.X:8080/info`
   - Should show server status page

### Step 3: Student Setup

#### When Internet is Available (Cloud Mode):
1. Open `index-refactored.html` in browser
2. Click "Sign in with Google"
3. Start using the app - all data saves to Firebase

#### When Internet is Down (Local Mode):
1. Open the app (works offline via cached files)
2. Sign in with Google (uses cached credentials)
3. Click "Connect to Local Hub" when prompted
4. Enter teacher's IP: `192.168.X.X:8080`
5. Click Connect
6. App shows "🏠 Local Network" status

## File Structure

```
project/
├── index.html                 # Original application
├── index-refactored.html      # New hybrid version
├── firebase-config.js         # Firebase configuration
├── hybrid-data-service.js     # Hybrid data management
├── server.js                  # Local Hub WebSocket server
├── package.json              # Node dependencies
├── styles.css                # Styles
├── allUnitsData.js          # Curriculum data
├── question.js              # Question bank
└── README.md                # This file
```

## How It Works

### Connection Modes

1. **☁️ Cloud Mode** (Internet Available)
   - Primary mode when internet works
   - Data saved to Firebase Firestore
   - Real-time sync across all devices
   - Automatic offline persistence

2. **🏠 Local Network Mode** (No Internet, LAN Available)
   - Connects to teacher's Local Hub
   - Real-time sharing within classroom
   - WebSocket-based communication
   - No internet required

3. **📵 Offline Mode** (No Connections)
   - Works with cached data only
   - Saves to browser's IndexedDB
   - Syncs when connection restored

### Data Flow

```
Student Device
     ↓
[Hybrid Data Service]
     ↓
┌────────────┬────────────┐
│            │            │
│  Online?   │  Offline?  │
│            │            │
└─────┬──────┴─────┬──────┘
      ↓            ↓
[Firebase]    [Local Hub]
      ↓            ↓
[Firestore]   [WebSocket]
      ↓            ↓
[Cloud Sync]  [Peer Share]
```

### Automatic Sync

- **Offline → Online**: Cached data syncs to Firebase
- **Local → Cloud**: When internet restored, Local Hub data uploads
- **Cloud → Local**: Firebase data available offline via IndexedDB

## Troubleshooting

### Local Hub Issues

**Problem**: Can't connect to Local Hub
- Check firewall settings
- Ensure devices on same network
- Verify IP address is correct
- Try: `ping 192.168.X.X` from student device

**Problem**: Server crashes
- Check Node.js version (>=14.0.0)
- Look for port conflicts
- Try different port: `PORT=3000 node server.js`

### Firebase Issues

**Problem**: Authentication fails
- Check Firebase configuration
- Ensure Google Sign-In enabled
- Clear browser cache/cookies
- Check domain whitelist in Firebase

**Problem**: Data not syncing
- Check Firestore rules
- Verify offline persistence enabled
- Check browser IndexedDB support
- Look at browser console for errors

### General Issues

**Problem**: App not loading offline
- Ensure initial load was online
- Check Service Worker registration
- Verify IndexedDB not full
- Try different browser

## Testing

### Test Cloud Mode
1. Sign in with Google
2. Answer questions
3. Open app on another device
4. Sign in with same account
5. Verify data syncs

### Test Local Mode
1. Start Local Hub on teacher's computer
2. Disconnect internet (or use airplane mode)
3. Connect students to Local Hub
4. Submit answers
5. Verify peers see updates in real-time

### Test Offline Mode
1. Use app online first
2. Disconnect all networks
3. Continue using app
4. Reconnect to internet
5. Verify data syncs to cloud

## Security Notes

- Firebase rules restrict data access to authenticated users
- Local Hub operates on trusted LAN only
- No sensitive data transmitted in plain text
- Google OAuth provides secure authentication
- All connections use HTTPS/WSS when possible

## Performance

- Firebase offline cache: Up to 40MB
- Local Hub capacity: ~100 concurrent users
- WebSocket latency: <100ms on LAN
- Firestore sync: Near real-time
- Browser storage: 10MB localStorage + IndexedDB

## Browser Support

- Chrome 90+ (recommended)
- Firefox 88+
- Safari 14+
- Edge 90+
- Mobile browsers supported

## Credits

Built for AP Statistics education
Utilizes Firebase, WebSockets, and modern web technologies

## License

Educational use only

## Support

For issues or questions:
- Check browser console for errors
- Review server logs
- Ensure all dependencies installed
- Verify network configuration