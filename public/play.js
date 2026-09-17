(function(){
  var API='/api/v1';
  var sessionId='';
  var bets=[1,2,5,10,25];
  var betIndex=2;
  var spinning=false;
  var balance=1000;
  var reels=document.getElementById('reels');
  var message=document.getElementById('message');
  var balanceEl=document.getElementById('balance');
  var winEl=document.getElementById('lastWin');
  var betEl=document.getElementById('bet');
  var spinBet=document.getElementById('spinBet');
  var spinButton=document.getElementById('spin');
  var down=document.getElementById('betDown');
  var up=document.getElementById('betUp');

  function key(prefix){
    if(window.crypto&&window.crypto.randomUUID){return prefix+':'+window.crypto.randomUUID();}
    return prefix+':'+Date.now()+'-'+Math.random().toString(36).slice(2);
  }

  function setMessage(text){message.textContent=text;}
  function format(n){return Number(n||0).toFixed(2);}
  function updateControls(){
    var bet=bets[betIndex];
    betEl.textContent=format(bet);
    spinBet.textContent=format(bet)+' CR';
    down.disabled=spinning||betIndex===0;
    up.disabled=spinning||betIndex===bets.length-1;
    spinButton.disabled=spinning||!sessionId||balance<bet;
  }

  function request(path,options){
    options=options||{};
    var headers={'Accept':'application/json'};
    if(options.body!==undefined){headers['Content-Type']='application/json';}
    if(sessionId){headers['X-Demo-Session']=sessionId;}
    return fetch(API+path,{
      method:options.method||'GET',
      headers:headers,
      body:options.body!==undefined?JSON.stringify(options.body):undefined
    }).then(function(response){
      return response.json().catch(function(){return {};}).then(function(payload){
        if(!response.ok){
          var error=new Error((payload.error&&payload.error.message)||'API request failed');
          error.status=response.status;
          error.code=(payload.error&&payload.error.code)||'API_ERROR';
          throw error;
        }
        return payload;
      });
    });
  }

  function openSession(){
    setMessage('Demo wird verbunden…');
    return request('/session',{method:'POST',body:{player:''}})
      .then(function(payload){
        sessionId=payload.session.id;
        balance=Number(payload.session.balance||0);
        balanceEl.textContent=format(balance);
        setMessage('Bereit — Einsatz wählen und SPIN drücken');
        updateControls();
      })
      .catch(function(){
        sessionId='';
        setMessage('Demo-Server nicht erreichbar. Seite neu laden.');
        updateControls();
      });
  }

  function renderGrid(grid){
    while(reels.firstChild){reels.removeChild(reels.firstChild);}
    for(var r=0;r<grid.length;r++){
      for(var c=0;c<grid[r].length;c++){
        var symbol=grid[r][c];
        var el=document.createElement('div');
        el.className='symbol'+(symbol.id==='bar'?' is-bar':'');
        el.textContent=symbol.label;
        reels.appendChild(el);
      }
    }
  }

  function spin(){
    if(spinning||!sessionId){return;}
    var bet=bets[betIndex];
    if(balance<bet){setMessage('Nicht genug DEMO Credits');return;}
    spinning=true;
    reels.classList.add('spinning');
    setMessage('Server löst Spin auf…');
    updateControls();

    request('/spin',{
      method:'POST',
      body:{gameId:'golden-vault',bet:bet,idempotencyKey:key('showcase-spin')}
    }).then(function(payload){
      var result=payload.result;
      window.setTimeout(function(){
        renderGrid(result.grid);
        balance=Number(result.balance||0);
        balanceEl.textContent=format(balance);
        winEl.textContent=format(result.totalWin);
        setMessage(Number(result.totalWin)>0?'Gewinn! +'+format(result.totalWin)+' CR':'Kein Gewinn — nochmal drehen');
        spinning=false;
        reels.classList.remove('spinning');
        updateControls();
      },450);
    }).catch(function(error){
      spinning=false;
      reels.classList.remove('spinning');
      if(error.status===401){
        sessionId='';
        openSession();
      }else{
        setMessage('Spin nicht möglich. Seite neu laden.');
        updateControls();
      }
    });
  }

  down.addEventListener('click',function(){if(betIndex>0&&!spinning){betIndex--;updateControls();}});
  up.addEventListener('click',function(){if(betIndex<bets.length-1&&!spinning){betIndex++;updateControls();}});
  spinButton.addEventListener('click',spin);
  updateControls();
  openSession();
})();