(function(){
  'use strict';
  var API='/api/v1';
  var SESSION_KEY='gmvkasino.demo.sessionId';
  var AUTH_KEY='gmvkasino.auth.token';
  var bets=[1,2,5,10,25];
  var betIndex=2;
  var spinning=false;
  var balance=1000;
  var sessionId=storageGet(SESSION_KEY);
  var authToken=storageGet(AUTH_KEY);
  var profile=null;
  var operations=[];
  var toastTimer=null;

  function el(id){return document.getElementById(id);}
  function storageGet(key){try{return window.sessionStorage.getItem(key)||'';}catch(e){return '';}}
  function storageSet(key,value){try{if(value){window.sessionStorage.setItem(key,value);}else{window.sessionStorage.removeItem(key);}}catch(e){}}
  function key(prefix){if(window.crypto&&window.crypto.randomUUID){return prefix+':'+window.crypto.randomUUID();}return prefix+':'+Date.now()+'-'+Math.random().toString(36).slice(2);}
  function money(value){return Number(value||0).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function format(value){return Number(value||0).toFixed(2);}
  function safeText(value,fallback){return value===undefined||value===null||value===''?(fallback||'—'):String(value);}
  function toast(message,isError){var node=el('toast');node.textContent=message;node.className='toast show'+(isError?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(function(){node.className='toast';},3200);}
  function setSession(id){sessionId=id||'';storageSet(SESSION_KEY,sessionId);}
  function setAuth(token){authToken=token||'';storageSet(AUTH_KEY,authToken);}

  function request(path,options){
    options=options||{};
    var headers={'Accept':'application/json'};
    if(options.body!==undefined){headers['Content-Type']='application/json';}
    if(options.includeSession!==false&&sessionId){headers['X-Demo-Session']=sessionId;}
    if(options.includeAuth!==false&&authToken){headers.Authorization='Bearer '+authToken;}
    return fetch(API+path,{method:options.method||'GET',headers:headers,body:options.body!==undefined?JSON.stringify(options.body):undefined})
      .then(function(response){return response.json().catch(function(){return {};}).then(function(payload){
        if(!response.ok){var error=new Error(payload.error&&payload.error.message||'API request failed');error.status=response.status;error.code=payload.error&&payload.error.code||'API_ERROR';throw error;}
        return payload;
      });});
  }

  function setBalance(next){
    balance=Number(next||0);
    el('balance').textContent=format(balance);
    el('topBalance').textContent=money(balance)+' CR';
    el('cashierBalance').textContent=money(balance)+' CR';
    el('profileBalance').textContent=money(balance)+' CR';
    updateSpinControls();
  }

  function setServer(online){
    var badge=el('serverBadge');
    badge.textContent=online?'ONLINE':'OFFLINE';
    badge.className='server-badge'+(online?'':' offline');
    el('sessionState').textContent=online?'ACTIVE':'OFFLINE';
  }

  function showView(name){
    var views=document.querySelectorAll('.view');
    for(var i=0;i<views.length;i++){views[i].classList.remove('is-active');}
    var target=el('view-'+name);
    if(target){target.classList.add('is-active');}
    var nav=document.querySelectorAll('.nav-item');
    for(var j=0;j<nav.length;j++){nav[j].classList.toggle('is-active',nav[j].getAttribute('data-view')===name);}
    window.scrollTo(0,0);
    if(name==='cashier'||name==='account'){refreshIdentity();}
  }

  function openSession(){
    el('message').textContent='Demo wird verbunden…';
    return request('/session',{method:'POST',body:{player:''}})
      .then(function(payload){setSession(payload.session.id);setBalance(payload.session.balance);setServer(true);el('message').textContent='Bereit — Einsatz wählen und SPIN drücken';return payload.session;})
      .catch(function(error){setSession('');setServer(false);el('message').textContent='Demo-Server nicht erreichbar';throw error;});
  }

  function ensureSession(){
    if(!sessionId){return openSession();}
    return request('/session')
      .then(function(payload){setBalance(payload.session.balance);setServer(true);return payload.session;})
      .catch(function(){setSession('');return openSession();});
  }

  function updateSpinControls(){
    var bet=bets[betIndex];
    el('bet').textContent=format(bet);
    el('spinBet').textContent=format(bet)+' CR';
    el('betDown').disabled=spinning||betIndex===0;
    el('betUp').disabled=spinning||betIndex===bets.length-1;
    el('spin').disabled=spinning||!sessionId||balance<bet;
  }

  function renderGrid(grid){
    var reels=el('reels');
    while(reels.firstChild){reels.removeChild(reels.firstChild);}
    for(var r=0;r<grid.length;r++){for(var c=0;c<grid[r].length;c++){
      var symbol=grid[r][c];var node=document.createElement('div');
      node.className='symbol'+(symbol.id==='bar'?' bar':(symbol.id==='diamond'||symbol.id==='bell'?' gold':''));
      node.textContent=symbol.label;reels.appendChild(node);
    }}
  }

  function spin(){
    if(spinning||!sessionId){return;}
    var bet=bets[betIndex];
    if(balance<bet){toast('Nicht genug DEMO Credits',true);return;}
    spinning=true;el('reels').classList.add('spinning');el('message').textContent='Server löst Spin auf…';updateSpinControls();
    var idem=key('showcase-spin');
    function perform(){return request('/spin',{method:'POST',body:{gameId:'golden-vault',bet:bet,idempotencyKey:idem}});}
    perform().catch(function(error){
      if(error.status===401){setSession('');return openSession().then(perform);}
      throw error;
    }).then(function(payload){
      var result=payload.result;
      window.setTimeout(function(){renderGrid(result.grid);setBalance(result.balance);el('lastWin').textContent=format(result.totalWin);el('message').textContent=Number(result.totalWin)>0?'Gewinn! +'+format(result.totalWin)+' CR':'Kein Gewinn — nochmal drehen';spinning=false;el('reels').classList.remove('spinning');setServer(true);updateSpinControls();},430);
    }).catch(function(){spinning=false;el('reels').classList.remove('spinning');setServer(false);el('message').textContent='Spin nicht möglich';updateSpinControls();toast('Spin konnte nicht ausgeführt werden.',true);});
  }

  function accountName(){
    if(!profile||!profile.account){return 'G';}
    var name=profile.account.displayName||profile.account.email||'G';
    return String(name).charAt(0).toUpperCase();
  }

  function renderIdentity(){
    var authed=Boolean(profile&&profile.account&&authToken);
    el('accountGuest').classList.toggle('hidden',authed);
    el('accountAuthed').classList.toggle('hidden',!authed);
    el('cashierGuest').classList.toggle('hidden',authed);
    el('cashierAuthed').classList.toggle('hidden',!authed);
    el('accountButton').textContent=authed?accountName():'G';
    if(authed){
      var account=profile.account;
      el('profileName').textContent=safeText(account.displayName,'Demo Player');
      el('profileEmail').textContent=safeText(account.email);
      el('cashierEmail').textContent=safeText(account.email);
    }
  }

  function refreshPayments(){
    if(!authToken){operations=[];renderPayments();return Promise.resolve();}
    return request('/sandbox/payments',{includeSession:false}).then(function(payload){operations=payload.operations||[];renderPayments();});
  }

  function renderPayments(){
    var list=el('paymentHistory');
    while(list.firstChild){list.removeChild(list.firstChild);}
    if(!operations.length){var empty=document.createElement('p');empty.className='empty';empty.textContent='Noch keine Sandbox-Transaktionen.';list.appendChild(empty);return;}
    for(var i=0;i<operations.length;i++){
      var op=operations[i];var row=document.createElement('div');row.className='payment-row';
      var a=document.createElement('div');var title=document.createElement('strong');title.textContent=op.kind==='withdrawal'?'Auszahlung':'Einzahlung';var sub=document.createElement('small');sub.textContent=new Date(Number(op.createdAt)||Date.now()).toLocaleString('de-DE');a.appendChild(title);a.appendChild(sub);
      var b=document.createElement('div');var amount=document.createElement('span');amount.textContent=safeText(op.amountExact,'0.00')+' CR';b.appendChild(amount);
      var state=document.createElement('span');state.className='payment-state';state.textContent=safeText(op.status,'unknown').replace(/_/g,' ');
      row.appendChild(a);row.appendChild(b);row.appendChild(state);list.appendChild(row);
    }
  }

  function refreshIdentity(){
    if(!authToken){profile=null;renderIdentity();return ensureSession().catch(function(){});}
    return request('/auth/me',{includeSession:false})
      .then(function(payload){profile=payload.profile;renderIdentity();return Promise.all([request('/wallet'),refreshPayments()]);})
      .then(function(results){if(results&&results[0]&&results[0].wallet){setBalance(results[0].wallet.balance);}})
      .catch(function(error){if(error.status===401){setAuth('');profile=null;operations=[];renderIdentity();return openSession().catch(function(){});}toast('Account-Daten konnten nicht geladen werden.',true);});
  }

  function login(event){
    event.preventDefault();
    var email=el('loginEmail').value.trim();var password=el('loginPassword').value;
    request('/auth/login',{method:'POST',body:{email:email,password:password},includeSession:false,includeAuth:false})
      .then(function(payload){setAuth(payload.auth.token);setSession(payload.session.id);setBalance(payload.session.balance);el('loginPassword').value='';toast('Eingeloggt.');return refreshIdentity();})
      .then(function(){showView('account');})
      .catch(function(error){el('loginPassword').value='';toast(error.message||'Login fehlgeschlagen.',true);});
  }

  function register(event){
    event.preventDefault();
    var displayName=el('registerName').value.trim();var email=el('registerEmail').value.trim();var password=el('registerPassword').value;
    request('/auth/register',{method:'POST',body:{displayName:displayName,email:email,password:password},includeAuth:false})
      .then(function(payload){setAuth(payload.auth.token);setSession(payload.session.id);setBalance(payload.session.balance);el('registerPassword').value='';toast('Demo-Account erstellt.');return refreshIdentity();})
      .then(function(){showView('account');})
      .catch(function(error){el('registerPassword').value='';toast(error.message||'Registrierung fehlgeschlagen.',true);});
  }

  function logout(){
    var done=function(){setAuth('');setSession('');profile=null;operations=[];renderIdentity();return openSession();};
    if(!authToken){done();return;}
    request('/auth/logout',{method:'POST'}).catch(function(){}).then(done).then(function(){toast('Abgemeldet.');showView('lobby');});
  }

  function createPayment(kind,amount){
    if(!authToken){showView('account');return Promise.resolve();}
    var path=kind==='withdrawal'?'/sandbox/payments/withdrawals':'/sandbox/payments/deposits';
    return request(path,{method:'POST',includeSession:false,body:{amount:String(amount),idempotencyKey:key('showcase-'+kind)}})
      .then(function(payload){toast(kind==='withdrawal'?'DEMO-Auszahlung reserviert.':'DEMO-Deposit erstellt.');return Promise.all([refreshPayments(),request('/wallet')]);})
      .then(function(results){if(results[1]&&results[1].wallet){setBalance(results[1].wallet.balance);}})
      .catch(function(error){toast(error.message||'Sandbox-Transaktion fehlgeschlagen.',true);});
  }

  var navButtons=document.querySelectorAll('.js-nav');
  for(var i=0;i<navButtons.length;i++){navButtons[i].addEventListener('click',function(){showView(this.getAttribute('data-view'));});}
  el('heroPlay').addEventListener('click',function(){showView('game');});
  el('heroMachine').addEventListener('click',function(){showView('game');});
  el('gameGoldenVault').addEventListener('click',function(){showView('game');});
  el('betDown').addEventListener('click',function(){if(betIndex>0&&!spinning){betIndex--;updateSpinControls();}});
  el('betUp').addEventListener('click',function(){if(betIndex<bets.length-1&&!spinning){betIndex++;updateSpinControls();}});
  el('spin').addEventListener('click',spin);
  el('loginForm').addEventListener('submit',login);
  el('registerForm').addEventListener('submit',register);
  el('logoutButton').addEventListener('click',logout);
  el('depositForm').addEventListener('submit',function(event){event.preventDefault();createPayment('deposit',el('depositAmount').value);});
  el('withdrawForm').addEventListener('submit',function(event){event.preventDefault();createPayment('withdrawal',el('withdrawAmount').value);});
  el('refreshPayments').addEventListener('click',function(){refreshPayments().then(function(){toast('Transaktionen aktualisiert.');}).catch(function(){toast('Aktualisierung fehlgeschlagen.',true);});});

  updateSpinControls();
  renderIdentity();
  refreshIdentity().catch(function(){});
})();