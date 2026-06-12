// sync.js - Cloud Syncing Utility

window.GhostArcadeSync = {
    async push() {
        try {
            console.log('[Sync] Exporting data...');
            const lsData = this.exportLocalStorage();
            const idbData = await this.exportIndexedDB();

            const response = await fetch('/api/sync/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    localStorageJson: JSON.stringify(lsData),
                    indexedDbJson: JSON.stringify(idbData)
                })
            });

            if (response.ok) {
                console.log('[Sync] Data successfully pushed to cloud.');
                return true;
            } else {
                console.error('[Sync] Failed to push data.', await response.text());
                return false;
            }
        } catch (e) {
            console.error('[Sync] Push error:', e);
            return false;
        }
    },

    async pull() {
        try {
            console.log('[Sync] Fetching data from cloud...');
            const response = await fetch('/api/sync/pull');
            if (response.status === 401) {
                console.log('[Sync] Not logged in, skipping pull.');
                return;
            }

            const resData = await response.json();
            if (resData.success) {
                if (resData.localStorageJson) {
                    const lsData = JSON.parse(resData.localStorageJson);
                    this.importLocalStorage(lsData);
                }
                
                if (resData.indexedDbJson) {
                    const idbData = JSON.parse(resData.indexedDbJson);
                    await this.importIndexedDB(idbData);
                }
                console.log('[Sync] Data successfully pulled and imported.');
            }
        } catch (e) {
            console.error('[Sync] Pull error:', e);
        }
    },

    exportLocalStorage() {
        const data = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            data[key] = localStorage.getItem(key);
        }
        return data;
    },

    importLocalStorage(data) {
        if (!data || typeof data !== 'object') return;
        // Merge instead of clear to not destroy unsynced local data if any
        for (const [key, value] of Object.entries(data)) {
            localStorage.setItem(key, value);
        }
    },

    async exportIndexedDB() {
        const exportData = {};
        if (!window.indexedDB.databases) {
            console.warn('[Sync] indexedDB.databases() not supported. Cannot sync IndexedDB automatically.');
            return exportData;
        }

        const dbs = await window.indexedDB.databases();
        for (const dbInfo of dbs) {
            try {
                const dbData = await this.exportSingleDB(dbInfo.name, dbInfo.version);
                exportData[dbInfo.name] = { version: dbInfo.version, stores: dbData };
            } catch (err) {
                console.error('[Sync] Failed to export DB ' + dbInfo.name + ':', err);
            }
        }
        return exportData;
    },

    exportSingleDB(dbName, version) {
        return new Promise((resolve, reject) => {
            const request = window.indexedDB.open(dbName, version);
            request.onerror = () => reject(request.error);
            request.onsuccess = (e) => {
                const db = e.target.result;
                const storeNames = Array.from(db.objectStoreNames);
                const dbExport = {};

                if (storeNames.length === 0) {
                    db.close();
                    return resolve(dbExport);
                }

                let completed = 0;
                let hasError = false;

                const transaction = db.transaction(storeNames, 'readonly');
                transaction.onerror = () => {
                    if (!hasError) { hasError = true; db.close(); reject(transaction.error); }
                };

                storeNames.forEach(storeName => {
                    const store = transaction.objectStore(storeName);
                    const allRequest = store.getAll();
                    const keysRequest = store.getAllKeys();

                    Promise.all([
                        new Promise((res, rej) => { 
                            allRequest.onsuccess = () => res(allRequest.result); 
                            allRequest.onerror = () => rej(allRequest.error);
                        }),
                        new Promise((res, rej) => { 
                            keysRequest.onsuccess = () => res(keysRequest.result); 
                            keysRequest.onerror = () => rej(keysRequest.error);
                        })
                    ]).then(([values, keys]) => {
                        const storeData = {};
                        for (let i = 0; i < keys.length; i++) {
                            storeData[keys[i]] = values[i];
                        }
                        dbExport[storeName] = storeData;
                        
                        completed++;
                        if (completed === storeNames.length) {
                            db.close();
                            resolve(dbExport);
                        }
                    }).catch(err => {
                        db.close();
                        reject(err);
                    });
                });
            };
        });
    },

    async importIndexedDB(data) {
        if (!data || typeof data !== 'object') return;

        for (const [dbName, dbInfo] of Object.entries(data)) {
            try {
                await this.importSingleDB(dbName, dbInfo.version, dbInfo.stores);
            } catch (err) {
                console.error('[Sync] Failed to import DB ' + dbName + ':', err);
            }
        }
    },

    importSingleDB(dbName, version, storesData) {
        return new Promise((resolve, reject) => {
            const request = window.indexedDB.open(dbName, version);
            
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                for (const storeName of Object.keys(storesData)) {
                    if (!db.objectStoreNames.contains(storeName)) {
                        db.createObjectStore(storeName);
                    }
                }
            };

            request.onerror = () => reject(request.error);
            request.onsuccess = (e) => {
                const db = e.target.result;
                const storeNames = Object.keys(storesData).filter(s => db.objectStoreNames.contains(s));
                
                if (storeNames.length === 0) {
                    db.close();
                    return resolve();
                }

                const transaction = db.transaction(storeNames, 'readwrite');
                transaction.oncomplete = () => {
                    db.close();
                    resolve();
                };
                transaction.onerror = () => {
                    db.close();
                    reject(transaction.error);
                };

                storeNames.forEach(storeName => {
                    const store = transaction.objectStore(storeName);
                    const storeData = storesData[storeName];
                    for (const [key, value] of Object.entries(storeData)) {
                        let parsedKey = key;
                        // Attempt to parse number keys if they were stringified
                        if (!isNaN(key)) parsedKey = Number(key);
                        store.put(value, parsedKey);
                    }
                });
            };
        });
    }
};
