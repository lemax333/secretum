// Copyright 2016-2017 Danylo Vashchilenko
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { SyncThenable } from './sync-thenable.js';

export class Store {
  constructor(config) {
    this.config = config;
  }

  findGroups() {
    this._transaction(['groups'],{strategy: 'new'});
    return Promise.resolve(this._storeGetAll('groups').then(Object.values));
  }

  findSecrets(query) {
    const match = (secret) => {
      if(query === undefined) return true;

      if(query.group !== undefined && secret.groupId !== query.group) {
        return false;
      }

      if(query.keyword !== undefined) {
        query.keyword = query.keyword.toLowerCase();
        if(secret.resource.search(query.keyword)==-1
          && secret.principal.search(query.keyword)==-1
          && secret.note.search(query.keyword)==-1) {
            return false;
          }
      }
      return true;
    };

    this._transaction(['secrets'],{strategy: 'new'});

    return Promise.resolve(
      this._storeGetAll('secrets')
        .then(secrets => Object.values(secrets).filter(match))
    );
  }

  saveSecret(secret) {
    const stores = this._openStores(['meta','secrets'], 'readwrite');

    const updateChanges = thenify(stores.meta.get('changes'))
      .then(changes => {
        if(changes.secrets === undefined) changes.secrets = {};
        if(changes.secrets.update === undefined) changes.secrets.update = [];
        changes.secrets.update.push(secret);

        return thenify(stores.meta.put(changes, 'changes'));
    });

    const putSecret = thenify(stores.secrets.put(secret));

    return SyncThenable.all([updateChanges, putSecret]);
  }

  createSecret(secret) {
    this._transaction(['meta','secrets'], {mode: 'readwrite', strategy: 'new'});
    const stores = this._openStores(['meta','secrets'], 'readwrite');

    // Will be autogenerated by IDB
    delete secret.id;

    const thenable = thenify(stores.secrets.put(secret)).then(id => {
      secret.id = id;
    }).then(() => thenify(stores.meta.get('changes'))).then(changes => {
      if(changes.secrets === undefined) changes.secrets = {};
      if(changes.secrets.update === undefined) changes.secrets.insert = [];
      changes.secrets.insert.push(secret);

      return thenify(stores.meta.put(changes, 'changes'));
    });

    return Promise.resolve(thenable);
  }

  removeSecret(id) {
    const stores = this._openStores(['meta','secrets'], 'readwrite');
    const thenable = SyncThenable.all([
      thenify(stores.secrets.get(id)),
      thenify(stores.meta.get('changes'))
    ]).then(([secret,changes]) => {
      if(secret === null) throw new Error(`Attempting to remove a non-existing secret with ID ${id}`);

      if(changes.secrets === undefined) changes.secrets = {};
      if(changes.secrets.delete === undefined) changes.secrets.delete = [];
      changes.secrets.delete.push(secret);

      return thenify(stores.meta.put(changes, 'changes'));
    }).then(()=>thenify(stores.secrets.delete(id)));

    return Promise.resolve(thenable);
  }

  getSecret(id) {
    this._transaction(['secrets'],{strategy: 'new'});
    return Promise.resolve(this._storeGetByKey('secrets', id));
  }

  getGroup(id) {
    this._transaction(['groups'],{strategy: 'new'});
    return this._storeGetByKey('groups', id);
  }

  _request(method, path, params, body) {
    path = params === undefined ? path :
      path+'?'+Object.keys(params).map(key=>key+'='+encodeURIComponent(params[key])).join('&');
    const payload = (resolve, reject) => {
      var xhr = new XMLHttpRequest();
      xhr.open(method, this.config.endpoint + path);
      xhr.responseType = "json";
      xhr.onload = () => {
        if(xhr.status === 200) {
          resolve(xhr.response);
        } else {
          reject(new Error(xhr.statusText));
        }
      };
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.send(JSON.stringify(body));
    };
    return new SyncThenable(payload);
  }

  _get(path, {params={}} = {}) {
    return this._request("GET", path, params);
  }

  _post(path, {params={}, body=undefined} = {}) {
    return this._request("POST", path, params, body);
  }

  _openStores(storeNames, mode) {
    const tx = this._transaction(storeNames, {mode: mode});
    return Object.assign.apply(null, storeNames.map(name => ({[name]: tx.objectStore(name)})));
  }

  _openStore(storeName, mode) {
    return this._openStores([storeName], mode)[storeName];
  }

  _clearStores(storeNames) {
    return SyncThenable.all(Object.values(this._openStores(storeNames)).map(store => {
      return thenify(store.clear());
    }));
  }

  _transaction(stores, {mode='readonly', strategy='require'}={}) {
    if(this._tx && strategy !== 'new') {
      if(!stores.every(store => this._tx.stores.includes(store))) {
        throw new Error(`Attempted transaction (scope: ${stores}), while a narrower scope (${this._tx.stores}) is active.`);
      }
      if(mode === 'readwrite' && this._tx.mode != 'readwrite') {
        throw new Error('Attempted overlapping transaction with a more restrictive mode');
      }
      return this._tx.tx;
    } else {
      const tx = this.config.db.transaction(stores, mode);
      tx.onabort = tx.onerror = (error) => {
        console.error('Transaction failed', error);
        this._tx = undefined
      };

      tx.oncomplete = () => {
        console.log('Transaction completed.');
        this._tx = undefined
      };

      this._tx = {tx: tx, stores: stores, mode: mode};
      return tx;
    }
  }

  findRemoteVaults() {
    return this._get('/meta');
  }

  getSyncStatus() {
    this._transaction(['meta'], {strategy: 'new'});

    const ret = this._openStore('meta').get('sync');
    return Promise.resolve(thenify(ret)).then(res => res === undefined ? null : res);
  }

  sync() {
    this._transaction(['meta'], {mode: 'readonly', strategy: 'new'});
    return Promise.resolve(this._sync());
  }

  _sync() {
    return this._storeGetAll('meta').then(meta => {
        if(meta.sync === undefined) throw new Error('No vault to sync with!');
        const opts = {vaultId: meta.sync.vault.id};
        if(meta.sync.snapshot) {
          opts.sinceCommitId = meta.sync.snapshot.id;
        }

        return this._get(`/fetch`, {params: opts})
          .then(({vault: vault, snapshots: snapshots}) => ({vault: vault, snapshots: snapshots, meta: meta}));
      }).then(({vault: vault, meta: meta, snapshots: snapshots}) => {
        this._transaction(['secrets','groups','meta'], {mode: 'readwrite', strategy: 'new'});

        const stores = this._openStores(['secrets','groups','meta'], 'readwrite');

        const work = [];

        // Updating each store with corresponding changes in the shapshots
        snapshots.forEach(snapshot => {
          const delta = JSON.parse(snapshot.delta);
          Object.keys(delta).forEach(storeName => {
            if(Object.keys(delta[storeName]).includes('insert')) {
              delta[storeName].insert.forEach(datum => work.push(stores[storeName].put(datum)));
              // TODO: increment IDs of changes in the local store
            }
            if(Object.keys(delta[storeName]).includes('delete')) {
              delta[storeName].delete.forEach(datum => work.push(stores[storeName].delete(datum.id)));
              // TODO: unflag local removals if IDs match
            }
            if(Object.keys(delta[storeName]).includes('update')) {
              delta[storeName].update.forEach(datum => work.push(stores[storeName].put(datum)));
              // TODO: report merge conflict if IDs match
            }
          });
        });

        // Updating sync status
        meta.sync = meta.sync||{}
        meta.sync.vault = vault;
        if(snapshots.length > 0) {
          meta.sync.snapshot = snapshots[snapshots.length-1];
        }
        meta.sync.when = (new Date()).toISOString();
        work.push(stores.meta.put(meta.sync,'sync'));
        if(meta.changes === undefined) {
          meta.changes = {};
          work.push(stores.meta.put({}, 'changes'));
        }

        return SyncThenable.all(work.map(thenify))
          .then(()=>({meta: meta}));
      }).then(({meta: meta}) => {
        // If not dirty, pass context forward
        if(this._areChangesEmpty(meta.changes)) {
          return {meta: meta};
        }

        // Otherwise, post changes and update the sync status
        return this._post('/save', {params: {vaultId: meta.sync.vault.id}, body: meta.changes}).then(snapshot => {
          meta.changes = {};
          meta.sync.snapshot = snapshot;
          meta.sync.when = (new Date()).toISOString();
          const store = this._openStore('meta', 'readwrite');
          return SyncThenable.all([
            store.put(meta.changes, 'changes'),
            store.put(meta.sync, 'sync')
          ].map(thenify));
        }).then(()=>({meta: meta}));
      }).then(({meta: meta}) => meta.sync);
  }

  _areChangesEmpty(changes) {
    return changes===undefined
    ||(Object.values(changes).map(storeChanges => Object.values(storeChanges).map(x=>x.length))
      .reduce((a,v)=>a+v,0) === 0);
  }

  setup(vaultId) {
    // Locking meta until this.sync reads it
    this._transaction(['meta','secrets','groups'],{mode: 'readwrite', strategy: 'new'});
    this._clear();

    const meta = this._openStore('meta', 'readwrite');

    return Promise.resolve(
      SyncThenable.all([
        meta.put({vault: {id: vaultId}}, 'sync'),
        meta.put({}, 'changes')
      ].map(thenify))
        .then(()=>this._sync())
    );
  }

  isDirty() {
    return this._storeGetByKey('meta', 'changes').then(this._areChangesEmpty);
  }

  clear() {
    this._transaction(['meta','secrets','groups'], {mode: 'readwrite', strategy: 'new'});
    return this._clear();
  }

  _clear() {
    return this._clearStores(['meta','secrets','groups']);
  }

  getUnsyncedChanges() {
    return Promise.resolve(thenify(this._openStore('meta').get('changes')))
      .then(changes => changes === undefined ? {} : changes);
  }

  _storeGetByKey(store, key) {
    return thenify(this._transaction([store]).objectStore(store).get(key));
  }

  _storeGetAll(storeName) {
    const st = SyncThenable();

    const result = {};
    const request = this._transaction([storeName]).objectStore(storeName).openCursor();
    request.onerror = () => st.reject(request.error);
    request.onsuccess = function (event) {
      var cursor = event.target.result;
      if (cursor) {
          result[cursor.key] = cursor.value;
          cursor.continue();
      } else {
          st.resolve(result);
      }
    };

    return st;
  }
}

function thenify(request) {
  const ret = SyncThenable();
  request.onsuccess = () => ret.resolve(request.result);
  request.onerror = () => ret.reject(request.error);
  return ret;
}
