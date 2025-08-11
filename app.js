/* Froom front-end
 * - Anonymous Firebase Auth
 * - Firestore structure:
 *   /practices/{PRACTICE_CODE}
 *      - name: string
 *      - passHash: string (optional, for shared pass)
 *   /practices/{PRACTICE_CODE}/users/{uid}
 *      - displayName, role, availability, activity, location, note, lastActive, practiceCode
 *   /practices/{PRACTICE_CODE}/activity/{autoId}
 *      - byUid, byName, change, ts
 *
 * SECURITY: See firestore.rules for recommended rules.
 */

// 1) Paste your Firebase config here
const firebaseConfig = {
  apiKey: "PASTE_HERE",
  authDomain: "PASTE_HERE.firebaseapp.com",
  projectId: "PASTE_HERE",
  storageBucket: "PASTE_HERE.appspot.com",
  messagingSenderId: "PASTE_HERE",
  appId: "PASTE_HERE"
};

// 2) Optional: set a shared practice password (per practice) in Firestore under /practices/{code}.passHash
//    This client uses a simple SHA-256 check to compare (not strong security; just a shared secret).

/* ---------- helpers ---------- */
const $ = (sel) => document.querySelector(sel);
const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');

function hash(text){
  const enc = new TextEncoder();
  return crypto.subtle.digest('SHA-256', enc.encode(text))
    .then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join(''));
}

function formatTime(ts){
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toLocaleString();
}

/* ---------- state ---------- */
let app, auth, db, me = { uid:null, displayName:null, practiceCode:null, role:"Other" };
let unsubTeam = null, unsubActivity = null;
let presenceTimer = null;

/* ---------- init ---------- */
window.addEventListener('DOMContentLoaded', async () => {
  firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();

  // Tabs
  document.querySelectorAll('.tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.getAttribute('data-tab');
      ['overview','my','activity'].forEach(t => {
        (t==='overview' ? $('#tab-overview') : t==='my' ? $('#tab-my') : $('#tab-activity'))
          .classList.toggle('hidden', t !== tab);
      });
    });
  });

  // Login
  $('#loginBtn').addEventListener('click', enter);
  $('#saveBtn').addEventListener('click', saveMyStatus);
  $('#clearBtn').addEventListener('click', () => { $('#myNote').value=''; saveMyStatus(); });
  $('#logoutBtn').addEventListener('click', logout);

  // Restore last session
  const cached = JSON.parse(localStorage.getItem('froomUser') || 'null');
  if(cached && cached.practiceCode && cached.displayName){
    $('#practiceCode').value = cached.practiceCode;
    $('#displayName').value = cached.displayName;
    $('#role').value = cached.role || 'Other';
  }
});

async function enter(){
  const practiceCode = $('#practiceCode').value.trim().toUpperCase();
  const displayName = $('#displayName').value.trim();
  const role = $('#role').value;
  const pass = $('#practicePass').value;

  if(!practiceCode || !displayName){
    alert('Enter practice code and your name.');
    return;
  }

  // Check practice doc & shared pass (optional)
  const practiceRef = db.collection('practices').doc(practiceCode);
  const snap = await practiceRef.get();
  if(snap.exists){
    const data = snap.data();
    if(data.passHash){
      const enteredHash = await hash(pass || '');
      if(enteredHash !== data.passHash){
        alert('Incorrect shared practice password.');
        return;
      }
    }
  }else{
    // Autocreate a practice container doc (no pass)
    await practiceRef.set({ name: practiceCode, createdAt: Date.now() }, { merge: true });
  }

  // Sign in anonymously to get a uid for security rules
  if(!auth.currentUser){
    await auth.signInAnonymously();
  }

  me.uid = auth.currentUser.uid;
  me.displayName = displayName;
  me.practiceCode = practiceCode;
  me.role = role;

  // Create/update my user doc
  const userRef = db.collection('practices').doc(practiceCode).collection('users').doc(me.uid);
  const initial = {
    displayName, role, practiceCode, 
    availability: 'free',
    activity: 'Active now',
    location: '',
    note: '',
    lastActive: Date.now()
  };
  await userRef.set(initial, { merge: true });

  // Cache
  localStorage.setItem('froomUser', JSON.stringify({displayName, practiceCode, role}));

  $('#chipPractice').textContent = practiceCode;
  $('#chipName').textContent = displayName;

  hide($('#login'));
  show($('#app'));

  subscribeToTeam();
  subscribeToActivity();
  startPresencePing();
}

function startPresencePing(){
  if(presenceTimer) clearInterval(presenceTimer);
  presenceTimer = setInterval(async () => {
    if(!me.uid) return;
    await db.collection('practices').doc(me.practiceCode).collection('users').doc(me.uid)
      .set({ lastActive: Date.now() }, { merge: true });
  }, 25000); // every 25s
}

async function saveMyStatus(){
  if(!me.uid) return;
  const availability = $('#myAvail').value; // free | busy | dnd
  const activity = $('#myActivity').value;
  const location = $('#myLocation').value.trim();
  const note = $('#myNote').value.trim();

  const userRef = db.collection('practices').doc(me.practiceCode).collection('users').doc(me.uid);
  await userRef.set({ availability, activity, location, note, lastActive: Date.now() }, { merge:true });

  // Log activity
  await db.collection('practices').doc(me.practiceCode).collection('activity').add({
    byUid: me.uid,
    byName: me.displayName,
    change: `${availability.toUpperCase()} • ${activity}${location? ' @ '+location:''}${note? ' — '+note:''}`,
    ts: Date.now()
  });

  alert('Saved!');
}

function subscribeToTeam(){
  if(unsubTeam) unsubTeam();
  const ref = db.collection('practices').doc(me.practiceCode).collection('users');
  unsubTeam = ref.orderBy('displayName').onSnapshot((qs) => {
    const wrap = $('#team');
    wrap.innerHTML = '';
    if(qs.empty){ hide($('#team')); show($('#teamEmpty')); return; }
    show($('#team')); hide($('#teamEmpty'));
    const now = Date.now();

    qs.forEach(doc => {
      const u = doc.data();
      const online = (now - (u.lastActive||0)) < 60000; // 60s seen as 'online'
      const dotCls = u.availability === 'busy' ? 'statusDot dot-busy' : (u.availability === 'dnd' ? 'statusDot dot-dnd' : 'statusDot');
      const badgeCls = u.availability === 'busy' ? 'badge busy' : (u.availability === 'dnd' ? 'badge dnd' : 'badge ok');

      const div = document.createElement('div');
      div.className = 'user';
      div.innerHTML = `
        <div class="${dotCls}"></div>
        <div style="flex:1">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
            <strong>${u.displayName || 'Unknown'}</strong>
            <span class="${badgeCls}">${(u.availability||'free').toUpperCase()}</span>
          </div>
          <div class="note">${u.activity || ''}${u.location? ' • '+u.location:''}${u.note? ' — '+u.note:''}</div>
          <div class="note">${online? 'Online' : 'Last active ' + new Date(u.lastActive||0).toLocaleTimeString()}</div>
        </div>
      `;
      wrap.appendChild(div);
    });
  });
}

function subscribeToActivity(){
  if(unsubActivity) unsubActivity();
  const ref = db.collection('practices').doc(me.practiceCode).collection('activity');
  unsubActivity = ref.orderBy('ts','desc').limit(50).onSnapshot(qs => {
    const wrap = $('#activity');
    wrap.innerHTML = '';
    if(qs.empty){ hide($('#activity')); show($('#activityEmpty')); return; }
    show($('#activity')); hide($('#activityEmpty'));
    qs.forEach(doc => {
      const a = doc.data();
      const item = document.createElement('div');
      item.className = 'user';
      item.innerHTML = `
        <div class="badge">${new Date(a.ts).toLocaleTimeString()}</div>
        <div style="flex:1; padding-left:8px;">
          <strong>${a.byName || 'Unknown'}</strong>
          <div class="note">${a.change || ''}</div>
        </div>
      `;
      wrap.appendChild(item);
    });
  });
}

async function logout(){
  if(unsubTeam) unsubTeam();
  if(unsubActivity) unsubActivity();
  if(presenceTimer) clearInterval(presenceTimer);
  await auth.signOut();
  me = { uid:null, displayName:null, practiceCode:null, role:"Other" };
  show($('#login'));
  hide($('#app'));
}
