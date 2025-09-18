/**
 * Hybrid Data Service
 * Manages both Firebase (online) and WebSocket (offline) data persistence
 */

const HybridDataService = {
    // Connection state
    connectionMode: 'offline', // 'cloud', 'local', or 'offline'
    wsConnection: null,
    wsReconnectAttempts: 0,
    maxReconnectAttempts: 5,
    reconnectDelay: 2000,

    // Unsubscribe functions for Firestore listeners
    firestoreListeners: new Map(),

    // Local cache for offline mode
    localCache: {
        responses: new Map(),
        peerData: new Map()
    },

    /**
     * Initialize the hybrid data service
     */
    async initialize() {
        console.log('Initializing Hybrid Data Service...');

        // Initialize Firebase
        const firebaseInitialized = await FirebaseConfig.initialize();

        // Check online status
        this.setupOnlineStatusMonitoring();

        // Set initial connection mode
        if (navigator.onLine && firebaseInitialized) {
            this.setConnectionMode('cloud');
        } else {
            this.setConnectionMode('offline');
        }

        // Setup auth state listener
        window.addEventListener('authStateChanged', (event) => {
            this.handleAuthStateChange(event.detail);
        });

        return true;
    },

    /**
     * Setup online/offline status monitoring
     */
    setupOnlineStatusMonitoring() {
        window.addEventListener('online', () => {
            console.log('Network connection restored');
            if (FirebaseConfig.isSignedIn()) {
                this.setConnectionMode('cloud');
                this.syncLocalToCloud();
            }
        });

        window.addEventListener('offline', () => {
            console.log('Network connection lost');
            this.setConnectionMode('offline');
            this.showOfflineNotification();
        });
    },

    /**
     * Set connection mode and update UI
     */
    setConnectionMode(mode) {
        this.connectionMode = mode;
        this.updateConnectionStatus();

        // Dispatch event for UI updates
        window.dispatchEvent(new CustomEvent('connectionModeChanged', {
            detail: { mode }
        }));
    },

    /**
     * Update connection status in UI
     */
    updateConnectionStatus() {
        const statusElement = document.getElementById('connectionStatus');
        if (!statusElement) return;

        switch (this.connectionMode) {
            case 'cloud':
                statusElement.innerHTML = '<span class="status-cloud">☁️ Online</span>';
                statusElement.className = 'connection-status online';
                break;
            case 'local':
                statusElement.innerHTML = '<span class="status-local">🏠 Local Network</span>';
                statusElement.className = 'connection-status local';
                break;
            case 'offline':
                statusElement.innerHTML = '<span class="status-offline">📵 Offline</span>';
                statusElement.className = 'connection-status offline';
                break;
        }
    },

    /**
     * Connect to Local Hub WebSocket server
     */
    async connectToLocalHub(serverIP) {
        if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
            console.log('Already connected to Local Hub');
            return true;
        }

        try {
            const wsUrl = `ws://${serverIP}`;
            console.log(`Connecting to Local Hub at ${wsUrl}`);

            this.wsConnection = new WebSocket(wsUrl);

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Connection timeout'));
                }, 5000);

                this.wsConnection.onopen = () => {
                    clearTimeout(timeout);
                    console.log('Connected to Local Hub');
                    this.setConnectionMode('local');
                    this.wsReconnectAttempts = 0;

                    // Identify user
                    const user = FirebaseConfig.getCurrentUser();
                    if (user) {
                        this.wsConnection.send(JSON.stringify({
                            type: 'identify',
                            userId: user.uid,
                            displayName: user.displayName || 'Anonymous'
                        }));
                    }

                    // Request data sync
                    this.wsConnection.send(JSON.stringify({
                        type: 'request_sync'
                    }));

                    resolve(true);
                };

                this.wsConnection.onerror = (error) => {
                    clearTimeout(timeout);
                    console.error('WebSocket error:', error);
                    reject(error);
                };

                this.wsConnection.onmessage = (event) => {
                    this.handleWebSocketMessage(event.data);
                };

                this.wsConnection.onclose = () => {
                    console.log('Disconnected from Local Hub');
                    this.handleWebSocketDisconnect();
                };
            });
        } catch (error) {
            console.error('Failed to connect to Local Hub:', error);
            return false;
        }
    },

    /**
     * Handle WebSocket messages
     */
    handleWebSocketMessage(data) {
        try {
            const message = JSON.parse(data);

            switch (message.type) {
                case 'welcome':
                    console.log('Welcome message received:', message);
                    break;

                case 'peer_response':
                    this.handlePeerResponse(message);
                    break;

                case 'bulk_update':
                    this.handleBulkUpdate(message.responses);
                    break;

                case 'sync_response':
                    this.handleSyncResponse(message);
                    break;

                case 'user_joined':
                case 'user_disconnected':
                    this.updateActiveUsers(message);
                    break;

                case 'response_confirmed':
                    console.log('Response confirmed for question:', message.questionId);
                    break;

                default:
                    console.log('Unknown message type:', message.type);
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    },

    /**
     * Handle peer response from WebSocket
     */
    handlePeerResponse(response) {
        // Update local cache
        const questionId = response.questionId;
        if (!this.localCache.peerData.has(questionId)) {
            this.localCache.peerData.set(questionId, new Map());
        }

        this.localCache.peerData.get(questionId).set(response.userId, {
            answer: response.answer,
            reason: response.reason,
            displayName: response.displayName,
            timestamp: response.timestamp
        });

        // Dispatch event for UI update
        window.dispatchEvent(new CustomEvent('peerDataUpdated', {
            detail: { questionId, response }
        }));
    },

    /**
     * Handle bulk update from WebSocket
     */
    handleBulkUpdate(responses) {
        responses.forEach(response => {
            this.handlePeerResponse(response);
        });
    },

    /**
     * Handle sync response from WebSocket
     */
    handleSyncResponse(data) {
        if (data.responses) {
            this.handleBulkUpdate(data.responses);
        }

        if (data.activeUsers) {
            console.log('Active users:', data.activeUsers);
        }
    },

    /**
     * Handle WebSocket disconnect
     */
    handleWebSocketDisconnect() {
        this.wsConnection = null;

        if (this.connectionMode === 'local') {
            // Try to reconnect if we were in local mode
            if (this.wsReconnectAttempts < this.maxReconnectAttempts) {
                this.wsReconnectAttempts++;
                console.log(`Attempting to reconnect (${this.wsReconnectAttempts}/${this.maxReconnectAttempts})...`);

                setTimeout(() => {
                    const lastServerIP = localStorage.getItem('lastLocalHubIP');
                    if (lastServerIP) {
                        this.connectToLocalHub(lastServerIP);
                    }
                }, this.reconnectDelay * this.wsReconnectAttempts);
            } else {
                this.setConnectionMode('offline');
                this.showReconnectFailedNotification();
            }
        }
    },

    /**
     * Save quiz response (works in all modes)
     */
    async saveResponse(questionId, answer, reason = '') {
        const user = FirebaseConfig.getCurrentUser();
        if (!user) {
            console.error('No user signed in');
            return false;
        }

        const responseData = {
            questionId,
            answer,
            reason,
            userId: user.uid,
            displayName: user.displayName,
            timestamp: Date.now()
        };

        // Save to local cache first
        if (!this.localCache.responses.has(questionId)) {
            this.localCache.responses.set(questionId, new Map());
        }
        this.localCache.responses.get(questionId).set(user.uid, responseData);

        let saved = false;

        // Try to save based on connection mode
        switch (this.connectionMode) {
            case 'cloud':
                // Save to Firestore
                saved = await FirebaseConfig.saveQuizResponse(questionId, answer, reason);
                break;

            case 'local':
                // Send to WebSocket server
                if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
                    this.wsConnection.send(JSON.stringify({
                        type: 'submit_response',
                        ...responseData
                    }));
                    saved = true;
                }
                break;

            case 'offline':
                // Already saved to local cache
                saved = true;
                console.log('Saved to local cache (offline mode)');
                break;
        }

        // Dispatch event for UI update
        window.dispatchEvent(new CustomEvent('responseSaved', {
            detail: { questionId, saved, mode: this.connectionMode }
        }));

        return saved;
    },

    /**
     * Get peer responses for a question
     */
    async getPeerResponses(questionId) {
        switch (this.connectionMode) {
            case 'cloud':
                // Get from Firestore
                return await FirebaseConfig.getClassResponses(questionId);

            case 'local':
            case 'offline':
                // Get from local cache
                const responses = [];
                const questionData = this.localCache.peerData.get(questionId);
                if (questionData) {
                    questionData.forEach((data, userId) => {
                        responses.push({
                            userId,
                            ...data
                        });
                    });
                }
                return responses;

            default:
                return [];
        }
    },

    /**
     * Subscribe to real-time updates for a question
     */
    subscribeToQuestion(questionId, callback) {
        if (this.connectionMode === 'cloud') {
            // Subscribe to Firestore real-time updates
            const unsubscribe = FirebaseConfig.subscribeToClassResponses(questionId, callback);
            this.firestoreListeners.set(questionId, unsubscribe);
            return unsubscribe;
        } else {
            // In local/offline mode, updates come through WebSocket or are already cached
            // Set up event listener for updates
            const handler = (event) => {
                if (event.detail.questionId === questionId) {
                    this.getPeerResponses(questionId).then(callback);
                }
            };

            window.addEventListener('peerDataUpdated', handler);

            // Return cleanup function
            return () => {
                window.removeEventListener('peerDataUpdated', handler);
            };
        }
    },

    /**
     * Unsubscribe from question updates
     */
    unsubscribeFromQuestion(questionId) {
        const unsubscribe = this.firestoreListeners.get(questionId);
        if (unsubscribe) {
            unsubscribe();
            this.firestoreListeners.delete(questionId);
        }
    },

    /**
     * Sync local cache to cloud when connection is restored
     */
    async syncLocalToCloud() {
        if (this.connectionMode !== 'cloud' || !FirebaseConfig.isSignedIn()) {
            return;
        }

        console.log('Syncing local cache to cloud...');

        const operations = [];

        // Sync all cached responses
        this.localCache.responses.forEach((questionResponses, questionId) => {
            questionResponses.forEach((response, userId) => {
                if (userId === FirebaseConfig.getCurrentUser()?.uid) {
                    operations.push(
                        FirebaseConfig.saveQuizResponse(
                            response.questionId,
                            response.answer,
                            response.reason
                        )
                    );
                }
            });
        });

        // Execute all sync operations
        const results = await Promise.allSettled(operations);

        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;

        console.log(`Sync complete: ${successful} successful, ${failed} failed`);

        if (successful > 0) {
            this.showSyncSuccessNotification(successful);
        }
    },

    /**
     * Handle auth state change
     */
    handleAuthStateChange(detail) {
        if (detail.isSignedIn) {
            console.log('User signed in:', detail.user.displayName);

            // If online, switch to cloud mode
            if (navigator.onLine) {
                this.setConnectionMode('cloud');
                this.syncLocalToCloud();
            }
        } else {
            console.log('User signed out');
            this.setConnectionMode('offline');

            // Clear listeners
            this.firestoreListeners.forEach(unsubscribe => unsubscribe());
            this.firestoreListeners.clear();
        }
    },

    /**
     * Show offline notification
     */
    showOfflineNotification() {
        const message = `
            <div class="notification warning">
                <strong>📵 Offline Mode</strong><br>
                Your progress is being saved locally.<br>
                <button onclick="HybridDataService.showLocalHubDialog()">Connect to Local Hub</button>
            </div>
        `;
        this.showNotification(message, 5000);
    },

    /**
     * Show Local Hub connection dialog
     */
    showLocalHubDialog() {
        const dialog = `
            <div class="local-hub-dialog">
                <h3>Connect to Local Hub</h3>
                <p>Enter the teacher's Local Hub IP address:</p>
                <input type="text" id="localHubIP" placeholder="e.g., 192.168.1.100:8080"
                       value="${localStorage.getItem('lastLocalHubIP') || ''}">
                <div class="dialog-buttons">
                    <button onclick="HybridDataService.connectToLocalHubFromDialog()">Connect</button>
                    <button onclick="HybridDataService.closeDialog()">Cancel</button>
                </div>
            </div>
        `;

        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';
        overlay.innerHTML = dialog;
        document.body.appendChild(overlay);
    },

    /**
     * Connect to Local Hub from dialog
     */
    async connectToLocalHubFromDialog() {
        const input = document.getElementById('localHubIP');
        const serverIP = input.value.trim();

        if (!serverIP) {
            alert('Please enter a server IP address');
            return;
        }

        // Save IP for next time
        localStorage.setItem('lastLocalHubIP', serverIP);

        // Try to connect
        try {
            const connected = await this.connectToLocalHub(serverIP);
            if (connected) {
                this.closeDialog();
                this.showNotification('✅ Connected to Local Hub', 3000);
            } else {
                alert('Failed to connect. Please check the IP address and try again.');
            }
        } catch (error) {
            alert(`Connection failed: ${error.message}`);
        }
    },

    /**
     * Close dialog
     */
    closeDialog() {
        const overlay = document.querySelector('.dialog-overlay');
        if (overlay) {
            overlay.remove();
        }
    },

    /**
     * Show notification
     */
    showNotification(message, duration = 3000) {
        const container = document.getElementById('messageArea') || document.body;
        const notification = document.createElement('div');
        notification.className = 'notification-message';
        notification.innerHTML = message;
        container.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, duration);
    },

    /**
     * Show sync success notification
     */
    showSyncSuccessNotification(count) {
        this.showNotification(`✅ ${count} response(s) synced to cloud`, 3000);
    },

    /**
     * Show reconnect failed notification
     */
    showReconnectFailedNotification() {
        this.showNotification('❌ Failed to reconnect to Local Hub. Working offline.', 5000);
    },

    /**
     * Update active users from WebSocket
     */
    updateActiveUsers(message) {
        console.log(`User ${message.displayName} ${message.type === 'user_joined' ? 'joined' : 'left'}`);
        console.log(`Active users: ${message.activeUsers}`);

        // Dispatch event for UI update
        window.dispatchEvent(new CustomEvent('activeUsersUpdated', {
            detail: message
        }));
    }
};