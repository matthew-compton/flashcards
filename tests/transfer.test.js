import test from 'node:test';
import assert from 'node:assert/strict';
import { receiveMigration, stagedMigration, clearMigration } from '../src/transfer.js';

test('direct transfer requires the exact opener and one-time nonce and preserves the full library', () => {
  const nonce='a'.repeat(64);
  let listener;
  let staged;
  const messages=[];
  const source={postMessage:message=>messages.push(message)};
  globalThis.location={hash:'#transfer='+nonce,pathname:'/flashcards/',search:''};
  globalThis.history={replaceState(){}};
  globalThis.localStorage={getItem:()=>staged,setItem:(_,value)=>{staged=value;},removeItem:()=>{staged=null;}};
  globalThis.document={getElementById:()=>({textContent:''})};
  globalThis.window={opener:source,addEventListener:(_,callback)=>{listener=callback;},removeEventListener(){},dispatchEvent(){}};
  receiveMigration();
  const library={version:11,decks:[{id:'one',name:'Test',category:'Test',correct:7,attempts:10,cards:[{fr:'example',en:'example answer'}],sessions:[{id:'historic',direction:'fr',correct:7,attempts:10,checkedAt:'2026-11-18'}]}]};
  listener({source:{},data:{type:'flashcards.library',nonce,library}});
  assert.equal(staged,undefined);
  listener({source,data:{type:'flashcards.library',nonce:'wrong',library}});
  assert.equal(staged,undefined);
  listener({source,data:{type:'flashcards.library',nonce,library}});
  const transferred=stagedMigration();
  assert.equal(transferred.decks[0].correct,7);
  assert.deepEqual(transferred.decks[0].sessions,library.decks[0].sessions);
  assert.equal(messages.at(-1).type,'flashcards.received');
  clearMigration();
  assert.equal(stagedMigration(),null);
});
