/**
 * Firebase Configuration and Initialization
 * Handles Firebase setup, authentication, and Firestore database
 */

const FirebaseConfig = {
    // Firebase project configuration - Replace with your actual config
    config: {
        apiKey: "YOUR_API_KEY",
        authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
        projectId: "YOUR_PROJECT_ID",
        storageBucket: "YOUR_PROJECT_ID.appspot.com",
        messagingSenderId: "YOUR_SENDER_ID",
        appId: "YOUR_APP_ID"
    },

    // Firestore collections
    collections: {
        users: 'users',
        classData: 'classData',
        sessions: 'sessions',
        quizResponses: 'quizResponses'
    },

    // Authentication state
    auth: {
        currentUser: null,
        isInitialized: false
    },

    // Initialize Firebase
    async initialize() {
        try {
            // Initialize Firebase app
            if (!firebase.apps.length) {
                firebase.initializeApp(this.config);
            }

            // Get auth and firestore instances
            this.authInstance = firebase.auth();
            this.db = firebase.firestore();

            // Enable offline persistence
            try {
                await this.db.enablePersistence({ synchronizeTabs: true });
                console.log('Offline persistence enabled');
            } catch (err) {
                if (err.code === 'failed-precondition') {
                    console.warn('Persistence failed: Multiple tabs open');
                } else if (err.code === 'unimplemented') {
                    console.warn('Persistence not supported in this browser');
                }
            }

            // Set up auth state listener
            this.authInstance.onAuthStateChanged(async (user) => {
                this.auth.currentUser = user;
                this.auth.isInitialized = true;

                if (user) {
                    await this.onUserSignIn(user);
                    this.notifyAuthStateChange(true);
                } else {
                    this.notifyAuthStateChange(false);
                }
            });

            return true;
        } catch (error) {
            console.error('Firebase initialization failed:', error);
            return false;
        }
    },

    // Sign in with Google
    async signInWithGoogle() {
        try {
            const provider = new firebase.auth.GoogleAuthProvider();
            provider.setCustomParameters({
                prompt: 'select_account'
            });

            const result = await this.authInstance.signInWithPopup(provider);
            return result.user;
        } catch (error) {
            console.error('Google sign-in failed:', error);
            throw error;
        }
    },

    // Sign out
    async signOut() {
        try {
            await this.authInstance.signOut();
            this.auth.currentUser = null;
        } catch (error) {
            console.error('Sign out failed:', error);
            throw error;
        }
    },

    // Handle user sign in
    async onUserSignIn(user) {
        try {
            // Create or update user document
            const userRef = this.db.collection(this.collections.users).doc(user.uid);
            const userDoc = await userRef.get();

            if (!userDoc.exists) {
                // New user - create profile
                await userRef.set({
                    uid: user.uid,
                    email: user.email,
                    displayName: user.displayName,
                    photoURL: user.photoURL,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    lastSignIn: firebase.firestore.FieldValue.serverTimestamp()
                });
            } else {
                // Existing user - update last sign in
                await userRef.update({
                    lastSignIn: firebase.firestore.FieldValue.serverTimestamp()
                });
            }

            // Load user data
            await this.loadUserData(user.uid);
        } catch (error) {
            console.error('Error handling user sign in:', error);
        }
    },

    // Load user data from Firestore
    async loadUserData(userId) {
        try {
            const userRef = this.db.collection(this.collections.users).doc(userId);
            const userData = await userRef.get();

            if (userData.exists) {
                return userData.data();
            }
            return null;
        } catch (error) {
            console.error('Error loading user data:', error);
            return null;
        }
    },

    // Save user progress
    async saveUserProgress(lessonId, progressData) {
        if (!this.auth.currentUser) {
            console.warn('No user signed in');
            return false;
        }

        try {
            const userId = this.auth.currentUser.uid;
            const progressRef = this.db
                .collection(this.collections.users)
                .doc(userId)
                .collection('progress')
                .doc(lessonId);

            await progressRef.set({
                ...progressData,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            return true;
        } catch (error) {
            console.error('Error saving progress:', error);
            return false;
        }
    },

    // Save quiz response
    async saveQuizResponse(questionId, answer, reason = '') {
        if (!this.auth.currentUser) {
            console.warn('No user signed in');
            return false;
        }

        try {
            const userId = this.auth.currentUser.uid;
            const responseData = {
                userId,
                questionId,
                answer,
                reason,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                displayName: this.auth.currentUser.displayName,
                email: this.auth.currentUser.email
            };

            // Save to user's personal responses
            const userResponseRef = this.db
                .collection(this.collections.users)
                .doc(userId)
                .collection('responses')
                .doc(questionId);

            await userResponseRef.set(responseData, { merge: true });

            // Also save to class-wide responses for real-time collaboration
            const classResponseRef = this.db
                .collection(this.collections.quizResponses)
                .doc(`${questionId}_${userId}`);

            await classResponseRef.set(responseData);

            return true;
        } catch (error) {
            console.error('Error saving quiz response:', error);
            return false;
        }
    },

    // Get class responses for a question
    async getClassResponses(questionId) {
        try {
            const snapshot = await this.db
                .collection(this.collections.quizResponses)
                .where('questionId', '==', questionId)
                .get();

            const responses = [];
            snapshot.forEach(doc => {
                responses.push(doc.data());
            });

            return responses;
        } catch (error) {
            console.error('Error getting class responses:', error);
            return [];
        }
    },

    // Subscribe to real-time class responses
    subscribeToClassResponses(questionId, callback) {
        if (!questionId || !callback) return null;

        const unsubscribe = this.db
            .collection(this.collections.quizResponses)
            .where('questionId', '==', questionId)
            .onSnapshot((snapshot) => {
                const responses = [];
                snapshot.forEach(doc => {
                    responses.push(doc.data());
                });
                callback(responses);
            }, (error) => {
                console.error('Error in real-time listener:', error);
            });

        return unsubscribe;
    },

    // Get user's responses
    async getUserResponses(userId = null) {
        const uid = userId || (this.auth.currentUser ? this.auth.currentUser.uid : null);
        if (!uid) return {};

        try {
            const snapshot = await this.db
                .collection(this.collections.users)
                .doc(uid)
                .collection('responses')
                .get();

            const responses = {};
            snapshot.forEach(doc => {
                responses[doc.id] = doc.data();
            });

            return responses;
        } catch (error) {
            console.error('Error getting user responses:', error);
            return {};
        }
    },

    // Notify auth state change
    notifyAuthStateChange(isSignedIn) {
        // Dispatch custom event for the main app to handle
        window.dispatchEvent(new CustomEvent('authStateChanged', {
            detail: {
                isSignedIn,
                user: this.auth.currentUser
            }
        }));
    },

    // Check if user is signed in
    isSignedIn() {
        return this.auth.currentUser !== null;
    },

    // Get current user
    getCurrentUser() {
        return this.auth.currentUser;
    },

    // Batch write for multiple operations
    async batchWrite(operations) {
        const batch = this.db.batch();

        operations.forEach(op => {
            switch(op.type) {
                case 'set':
                    batch.set(op.ref, op.data, op.options || {});
                    break;
                case 'update':
                    batch.update(op.ref, op.data);
                    break;
                case 'delete':
                    batch.delete(op.ref);
                    break;
            }
        });

        try {
            await batch.commit();
            return true;
        } catch (error) {
            console.error('Batch write failed:', error);
            return false;
        }
    },

    // Create session for local collaboration
    async createSession(sessionCode) {
        if (!this.auth.currentUser) return null;

        try {
            const sessionRef = this.db.collection(this.collections.sessions).doc(sessionCode);
            await sessionRef.set({
                createdBy: this.auth.currentUser.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                participants: [this.auth.currentUser.uid],
                isActive: true
            });
            return sessionCode;
        } catch (error) {
            console.error('Error creating session:', error);
            return null;
        }
    },

    // Join existing session
    async joinSession(sessionCode) {
        if (!this.auth.currentUser) return false;

        try {
            const sessionRef = this.db.collection(this.collections.sessions).doc(sessionCode);
            await sessionRef.update({
                participants: firebase.firestore.FieldValue.arrayUnion(this.auth.currentUser.uid)
            });
            return true;
        } catch (error) {
            console.error('Error joining session:', error);
            return false;
        }
    }
};