const ENDPOINT = 'https://chatbot-tawny-six-65.vercel.app/api/business-registration';
const byId = id => document.getElementById(id);
const map = { company:'b_name', registrationNumber:'b_reg', address:'b_addr', representative:'b_rep' };
const labels = { company:'상호명', registrationNumber:'사업자등록번호', address:'사업장 주소', representative:'대표자 성명' };
const review = byId('registration-review');
const login = byId('registration-login');
let authPromise, auth, generation=0, imageData=null, imageUrl=null, controller=null, busy=false, continueAfterConnect=false;
const status = (message, kind='') => { byId('registration-message').textContent=message; byId('registration-message').dataset.kind=kind; };
const setBusy = value => { busy=value; byId('registration-analyze').disabled=value; byId('registration-analyze').textContent=value?'사진을 읽고 있습니다…':'사진 다시 읽기'; review.setAttribute('aria-busy',String(value)); };
const revoke = () => { if(imageUrl)URL.revokeObjectURL(imageUrl); imageUrl=null; byId('registration-original').removeAttribute('src'); };

async function getAuthClient() {
  if(authPromise)return authPromise;
  authPromise=(async()=>{
    const [{initializeApp,getApps}, f]=await Promise.all([import('https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js')]);
    const name='contract-ai-auth';
    const app=getApps().find(a=>a.name===name)||initializeApp({apiKey:'AIzaSyB-wYELUMAs85APk_P4wRIpX216Tw50-2U',authDomain:'parts-inventory-71606.firebaseapp.com',projectId:'parts-inventory-71606',appId:'1:216547721139:web:c99ed4ea1c66be198515c6'},name);
    auth=f.getAuth(app);
    try{await f.setPersistence(auth,f.browserLocalPersistence);}catch{await f.setPersistence(auth,f.inMemoryPersistence);byId('registration-connect-note').textContent='이 기기에서는 계정 연결을 보관할 수 없어 앱을 다시 열 때 연결이 필요할 수 있습니다.';}
    await new Promise(resolve=>{const unsubscribe=f.onAuthStateChanged(auth,()=>{unsubscribe();resolve();},()=>resolve());});
    f.onAuthStateChanged(auth,user=>{const allowed=['mohoro@naver.com','mixfactorydj@gmail.com'].includes(user?.email?.toLowerCase());byId('registration-connect').textContent=allowed?(user.email.toLowerCase()==='mohoro@naver.com'?'대표 연결됨':'문과장 연결됨'):'AI 계정 연결';});
    return {auth,f};
  })().catch(error=>{authPromise=null;throw error;});
  return authPromise;
}

async function enabled() {
  const response=await fetch(ENDPOINT,{headers:{Accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('AI 연결 서버에 접속하지 못했습니다. 입력 내용은 그대로 유지됩니다.');
  const value=await response.json();
  if(!value.enabled)throw new Error('AI 인식은 아직 활성화되지 않았습니다. 사용 설정 전에는 원본을 보며 직접 입력할 수 있습니다.');
  return value;
}

async function connect(resume=false) {
  continueAfterConnect=resume;
  byId('registration-login-message').textContent='';
  byId('registration-password').value='';
  login.showModal();
  try { const a=await getAuthClient();if(a.auth.currentUser?.email)byId('registration-email').value=a.auth.currentUser.email; }
  catch { byId('registration-login-message').textContent='계정 연결 도구를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'; }
}

byId('registration-login-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const submit=byId('registration-login-submit');submit.disabled=true;
  try{
    const email=byId('registration-email').value.trim().toLowerCase();
    if(!['mohoro@naver.com','mixfactorydj@gmail.com'].includes(email))throw new Error('대표 또는 문과장의 기존 재고 앱 계정으로 연결해 주세요.');
    const a=await getAuthClient();
    await a.f.signInWithEmailAndPassword(a.auth,email,byId('registration-password').value);
    const resume=continueAfterConnect;continueAfterConnect=false;login.close();
    if(resume&&review.open&&imageData)await analyze();
  }catch(error){byId('registration-login-message').textContent=error.code?'이메일·비밀번호 또는 연결 상태를 확인해 주세요.':error.message;}
  finally{byId('registration-password').value='';submit.disabled=false;}
});
login.addEventListener('close',()=>{byId('registration-password').value='';continueAfterConnect=false;});
byId('registration-login-close').addEventListener('click',()=>login.close());
byId('registration-connect').addEventListener('click',()=>connect(false));

async function prepare(file) {
  if(!file||!/^image\//.test(file.type)||file.size>30*1024*1024)throw new Error('30MB 이하의 사진을 선택해 주세요.');
  const src=URL.createObjectURL(file);
  try{
    const image=new Image();image.src=src;await image.decode();
    if(!image.naturalWidth||!image.naturalHeight)throw new Error('사진을 읽을 수 없습니다.');
    const ratio=Math.min(1,2200/Math.max(image.naturalWidth,image.naturalHeight),Math.sqrt(3200000/(image.naturalWidth*image.naturalHeight)));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    let blob;
    for(const quality of [.9,.82,.72]){blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<=2*1024*1024)break;}
    if(!blob||blob.size>2*1024*1024)throw new Error('사진 크기를 줄이지 못했습니다. 등록증 부분만 잘라 선택해 주세요.');
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('사진을 읽지 못했습니다.'));reader.readAsDataURL(blob);});
    return {data,blob};
  }finally{URL.revokeObjectURL(src);}
}

async function pick(input) {
  const file=input.files?.[0];input.value='';if(!file)return;
  window.ContractDraft?.flush();
  const turn=++generation;
  controller?.abort();controller=null;imageData=null;revoke();
  byId('registration-confirm').checked=false;byId('registration-apply').disabled=true;
  for(const key of Object.keys(map)){byId('reg-'+key).value='';byId('reg-row-'+key).classList.remove('uncertain');byId('reg-flag-'+key).textContent='';byId('reg-use-'+key).checked=true;}
  byId('registration-warnings').replaceChildren();
  if(!review.open)review.showModal();setBusy(true);
  status('사진을 준비하고 있습니다…');
  try{
    const prepared=await prepare(file);if(turn!==generation||!review.open)return;
    imageData=prepared.data;imageUrl=URL.createObjectURL(prepared.blob);byId('registration-original').src=imageUrl;
    status('사진을 준비했습니다. AI 연결을 확인하고 있습니다.');setBusy(false);await analyze();
  }catch(error){if(turn!==generation)return;setBusy(false);status(error.message||'사진을 읽지 못했습니다. JPG 또는 PNG 사진을 선택해 주세요.','error');}
}

async function analyze() {
  if(busy||!imageData)return;
  const turn=generation;let requestController=null;setBusy(true);byId('registration-confirm').checked=false;byId('registration-apply').disabled=true;
  try{
    await enabled();if(turn!==generation||!review.open)return;
    const a=await getAuthClient();
    if(!a.auth.currentUser){setBusy(false);await connect(true);return;}
    const token=await a.auth.currentUser.getIdToken();
    if(turn!==generation||!review.open)return;
    requestController=new AbortController();controller=requestController;const timer=setTimeout(()=>requestController.abort(),60000);
    status('사진에서 네 항목을 읽고 있습니다. 확인 전에는 입력칸을 바꾸지 않습니다.');
    let response;
    try{response=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({image:imageData,mediaType:'image/jpeg',requestId:crypto.randomUUID()}),signal:requestController.signal});}
    finally{clearTimeout(timer);}
    const result=await response.json();if(turn!==generation||!review.open)return;
    if(!response.ok){if(response.status===401){setBusy(false);await connect(true);return;}throw new Error(result.error||'인식하지 못했습니다. 원본을 보며 직접 입력해 주세요.');}
    if(!result.fields||typeof result.fields!=='object')throw new Error('인식 결과 형식이 올바르지 않습니다. 다시 확인해 주세요.');
    for(const key of Object.keys(map)){
      byId('reg-'+key).value=typeof result.fields[key]==='string'?result.fields[key]:'';
      const uncertain=Array.isArray(result.uncertainFields)&&result.uncertainFields.includes(key)||!byId('reg-'+key).value;
      byId('reg-row-'+key).classList.toggle('uncertain',uncertain);byId('reg-flag-'+key).textContent=uncertain?'원본 확인 필요':'';
    }
    byId('registration-warnings').replaceChildren();
    for(const warning of (Array.isArray(result.warnings)?result.warnings:[]).slice(0,6)){const p=document.createElement('p');p.textContent=String(warning).slice(0,180);byId('registration-warnings').append(p);}
    status('원본과 아래 네 항목을 대조한 뒤 적용해 주세요. 틀린 부분은 이 화면에서 고칠 수 있습니다.','success');
  }catch(error){if(turn===generation&&review.open)status(error.name==='AbortError'?'응답을 받지 못했습니다. 입력값은 바뀌지 않았고 자동 재시도하지 않았습니다.':error.message,'error');}
  finally{if(turn===generation)setBusy(false);if(controller===requestController)controller=null;}
}

byId('registration-confirm').addEventListener('change',()=>{byId('registration-apply').disabled=!byId('registration-confirm').checked||busy;});
byId('registration-analyze').addEventListener('click',analyze);
byId('registration-review-close').addEventListener('click',()=>review.close());
review.addEventListener('close',()=>{generation++;controller?.abort();controller=null;imageData=null;revoke();setBusy(false);byId('registration-confirm').checked=false;byId('registration-apply').disabled=true;if(login.open)login.close();});
byId('registration-apply').addEventListener('click',()=>{
  if(busy||!byId('registration-confirm').checked)return;
  const updates=Object.keys(map).filter(k=>byId('reg-use-'+k).checked&&byId('reg-'+k).value.trim());
  if(!updates.length){status('입력할 항목을 하나 이상 선택해 주세요.','error');return;}
  if(updates.some(k=>/[<>\u0000-\u001f]/.test(byId('reg-'+k).value))){status('입력 내용에 사용할 수 없는 기호가 있습니다. 원본 글자만 입력해 주세요.','error');return;}
  const overwritten=updates.filter(k=>byId(map[k]).value.trim()&&byId(map[k]).value.trim()!==byId('reg-'+k).value.trim());
  if(overwritten.length&&!confirm(overwritten.map(k=>labels[k]).join(', ')+'의 기존 값을 바꿀까요?'))return;
  for(const key of updates){byId(map[key]).value=byId('reg-'+key).value.trim();byId(map[key]).dispatchEvent(new Event('input',{bubbles:true}));}
  window.ContractDraft?.flush();review.close();
  byId('ocrStatus').style.display='block';byId('ocrStatus').textContent=updates.length+'개 항목을 입력했습니다. 계약서는 아직 저장되지 않았습니다.';
});
window.BusinessRegistration={pick,connect};
