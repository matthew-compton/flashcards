import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { StudyStore } from '../src/storage.js';

const source = () => ({version:11,decks:[{id:'one',name:'Practice',category:'Test',correct:3,attempts:4,cards:[{fr:'example prompt',en:'example answer'}]}]});

function server() {
  const users = new Map();
  let offline = false;
  let loseResponse = false;
  return {
    set offline(value) {offline=value;},
    set loseResponse(value) {loseResponse=value;},
    forUser(owner) {
      return {async rpc(name, input) {
        assert.equal(name,'sync_flashcards');
        if (offline) return {error:new Error('Network unavailable')};
        const rows=users.get(owner)??[];
        for(const event of input.new_events) {
          if(!rows.some(row=>row.event.id===event.id)) rows.push({revision:rows.length+1,event:structuredClone(event)});
        }
        users.set(owner,rows);
        if(loseResponse) {loseResponse=false;return {error:new Error('Response lost')};}
        const page=rows.filter(row=>row.revision>input.after_revision).slice(0,2);
        return {data:{events:structuredClone(page),hasMore:page.at(-1)?.revision<rows.length}};
      }};
    },
    count(owner) {return users.get(owner)?.length??0;}
  };
}

test('offline answers persist after reopening and converge across two device caches', async () => {
  const backend=server();
  const owner=crypto.randomUUID();
  const a=await new StudyStore(backend.forUser(owner),owner).open();
  await a.importLibrary(source());
  backend.offline=true;
  const cardId=a.library.decks[0].cards[0].id;
  await a.commit([{type:'answer',payload:{deckId:'one',cardId,direction:'fr',correct:true,sessionId:'a',mode:'deck'}}]);
  await a.sync();
  assert.equal(a.pending.length,1);
  a.close();
  const reopened=await new StudyStore(backend.forUser(owner),owner).open();
  assert.equal(reopened.library.decks[0].attempts,5);
  backend.offline=false;
  await reopened.sync();
  assert.equal(reopened.pending.length,0);
  assert.equal(backend.count(owner),2);
  const b=await new StudyStore(backend.forUser(owner),owner,{databaseName:'phone-'+owner}).open();
  assert.equal(b.records.length,0);
  await b.sync();
  assert.equal(b.library.decks[0].correct,4);
  assert.deepEqual(b.library,reopened.library);
  reopened.close();b.close();
});

test('independent offline devices merge both answers and one device can undo its own answer', async () => {
  const backend=server();
  const owner=crypto.randomUUID();
  const a=await new StudyStore(backend.forUser(owner),owner,{databaseName:'pc-'+owner}).open();
  const b=await new StudyStore(backend.forUser(owner),owner,{databaseName:'mobile-'+owner}).open();
  await a.importLibrary(source());await b.sync();
  const cardId=a.library.decks[0].cards[0].id;
  backend.offline=true;
  const [answer]=await a.commit([{type:'answer',payload:{deckId:'one',cardId,direction:'fr',correct:true,sessionId:'desktop',mode:'deck'}}]);
  await b.commit([{type:'answer',payload:{deckId:'one',cardId,direction:'en',correct:false,sessionId:'phone',mode:'deck'}}]);
  await a.sync();await b.sync();
  backend.offline=false;
  await b.sync();await a.sync();await b.sync();
  assert.deepEqual(a.library,b.library);
  assert.equal(a.library.decks[0].attempts,6);
  await a.commit([{type:'answer.undo',payload:{answerId:answer.id}}]);
  await a.sync();await b.sync();
  assert.deepEqual(a.library,b.library);
  assert.equal(b.library.decks[0].attempts,5);
  assert.equal(b.library.decks[0].correct,3);
  assert.equal(b.library.decks[0].cards[0].review,undefined);
  assert.equal(b.library.decks[0].cards[0].recallReview.step,0);
  a.close();b.close();
});

test('lost network acknowledgement is safe to retry without double counting', async () => {
  const backend=server();
  const owner=crypto.randomUUID();
  const store=await new StudyStore(backend.forUser(owner),owner).open();
  await store.importLibrary(source());
  backend.loseResponse=true;
  await store.commit([{type:'answer',payload:{deckId:'one',cardId:store.library.decks[0].cards[0].id,direction:'en',correct:false,sessionId:'b',mode:'deck'}}]);
  await store.sync();
  await store.sync();
  assert.equal(backend.count(owner),2);
  assert.equal(store.library.decks[0].attempts,5);
  assert.equal(store.pending.length,0);
  store.close();
});

test('a second account has an isolated local cache and server event stream', async () => {
  const backend=server();
  const first=crypto.randomUUID(),second=crypto.randomUUID();
  const a=await new StudyStore(backend.forUser(first),first).open();
  const b=await new StudyStore(backend.forUser(second),second).open();
  await a.importLibrary(source());await b.sync();
  assert.equal(b.library.decks.length,0);
  assert.equal(b.records.length,0);
  a.close();b.close();
});

test('completed sync notifies controls after releasing the running state', async () => {
  const backend = server();
  const owner = crypto.randomUUID();
  const store = await new StudyStore(backend.forUser(owner), owner).open();
  const states = [];
  store.addEventListener('status', () => states.push({ status: store.status, running: Boolean(store.running) }));
  await store.sync();
  assert.deepEqual(states.at(-1), { status: 'Synced', running: false });
  store.close();
});
