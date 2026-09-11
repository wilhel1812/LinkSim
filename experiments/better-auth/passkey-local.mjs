// Only called by the local workerd fixture. Chromium handles all WebAuthn
// operations; virtual keys stay in memory and never reach logs or live services.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

export async function verifyLocalPasskeys({mf,db,origin,credential,otherCredential}) {
  assert.equal(origin,'https://linksim-auth-probe-local.example.workers.dev');
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
  try {
    const context=await browser.newContext();
    // No network access from the browser: only an empty secure-context document.
    await context.route('**/*',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Local passkey test</title>'}));
    const page=await context.newPage();
    await page.goto(origin);
    const cdp=await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const {authenticatorId}=await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{
      protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,
      isUserVerified:true,automaticPresenceSimulation:true}});
    const request=(path,{body,cookie=''}={})=>mf.dispatchFetch(origin+'/api/auth/passkey/'+path,{
      method:body?'POST':'GET',headers:{origin,'content-type':'application/json','cf-connecting-ip':'192.0.2.70',cookie},
      ...(body?{body:JSON.stringify(body)}:{})});
    const cookies=response=>response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
    const sessionCookie=credential.headers.get('cookie');
    const optionsResponse=await request('generate-register-options',{cookie:sessionCookie});
    assert.equal(optionsResponse.status,200);
    const registerCookie=sessionCookie+'; '+cookies(optionsResponse);
    const options=await optionsResponse.json();
    const registration=await page.evaluate(async options=>(await navigator.credentials.create({
      publicKey:PublicKeyCredential.parseCreationOptionsFromJSON(options)})).toJSON(),options);
    const registered=await request('verify-registration',{cookie:registerCookie,body:{response:registration,name:'Local virtual credential'}});
    assert.equal(registered.status,200);
    const key=await registered.json();
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM probe_passkey WHERE userId = ?').bind(credential.user.id).first()).n,1);
    const repeatedRegistration=await request('verify-registration',{cookie:registerCookie,body:{response:registration}});
    assert.equal(repeatedRegistration.status,400);
    await repeatedRegistration.arrayBuffer();
    const begin=async()=>{
      const response=await request('generate-authenticate-options');assert.equal(response.status,200);
      return {cookie:cookies(response),options:await response.json()};
    };
    const assertCredential=options=>page.evaluate(async options=>(await navigator.credentials.get({
      publicKey:PublicKeyCredential.parseRequestOptionsFromJSON(options)})).toJSON(),options);
    const verify=(attempt,response)=>request('verify-authentication',{cookie:attempt.cookie,body:{response}});
    const count=async()=>(await db.prepare('SELECT COUNT(*) AS n FROM probe_session').first()).n;
    const first=await begin();const assertion=await assertCredential(first.options);
    const before=await count();const login=await verify(first,assertion);assert.equal(login.status,200);
    assert.equal((await login.json()).user.id,credential.user.id);assert.equal(await count(),before+1);
    const reject=async(attempt,response)=>{
      const before=await count();const rejected=await verify(attempt,response);
      assert.ok([400,401].includes(rejected.status),'invalid assertion must fail closed');
      assert.ok(!rejected.headers.getSetCookie().some(v=>/session_token=[^;]/.test(v)));
      await rejected.arrayBuffer();assert.equal(await count(),before);
    };
    await reject(first,assertion); // Exact successful assertion and challenge-cookie replay.
    const signedForOldChallenge=await begin();const staleAssertion=await assertCredential(signedForOldChallenge.options);
    await reject(await begin(),staleAssertion); // Valid signature, wrong outstanding challenge.
    const wrongOrigin=await begin();
    await page.goto('https://other.'+new URL(origin).hostname);
    await reject(wrongOrigin,await assertCredential(wrongOrigin.options));
    await page.goto(origin);
    // Re-scope only the synthetic virtual key through Chromium's testing API.
    // Keep the original origin/signing key so the next failure isolates the RP hash.
    const stored=(await cdp.send('WebAuthn.getCredentials',{authenticatorId})).credentials;
    assert.equal(stored.length,1);
    const virtualKey=stored[0];
    await cdp.send('WebAuthn.removeCredential',{authenticatorId,credentialId:virtualKey.credentialId});
    const otherRP='example.workers.dev';
    await cdp.send('WebAuthn.addCredential',{authenticatorId,credential:{...virtualKey,rpId:otherRP}});
    const wrongRP=await begin();
    await reject(wrongRP,await assertCredential({...wrongRP.options,rpId:otherRP}));
    await cdp.send('WebAuthn.removeCredential',{authenticatorId,credentialId:virtualKey.credentialId});
    await cdp.send('WebAuthn.addCredential',{authenticatorId,credential:virtualKey});
    const invalidSignature=await begin();
    await cdp.send('WebAuthn.setResponseOverrideBits',{authenticatorId,isBogusSignature:true});
    await reject(invalidSignature,await assertCredential(invalidSignature.options));
    await cdp.send('WebAuthn.setResponseOverrideBits',{authenticatorId});
    const control=await begin();const validAgain=await verify(control,await assertCredential(control.options));
    assert.equal(validAgain.status,200,'the credential still works after the negative cases');
    assert.equal((await validAgain.json()).user.id,credential.user.id);
    const otherSession=await mf.dispatchFetch(origin+'/probe/session/reused',{headers:otherCredential.headers});
    assert.equal(otherSession.status,200,'the other user has a valid session');await otherSession.arrayBuffer();
    const forbiddenRemoval=await request('delete-passkey',{cookie:otherCredential.headers.get('cookie'),body:{id:key.id}});
    assert.equal(forbiddenRemoval.status,401,'library ownership check rejects another authenticated user');
    await forbiddenRemoval.arrayBuffer();
    const removed=await request('delete-passkey',{cookie:sessionCookie,body:{id:key.id}});
    assert.equal(removed.status,200);await removed.arrayBuffer();
    const afterRemoval=await begin();await reject(afterRemoval,await assertCredential(afterRemoval.options));
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM probe_passkey WHERE userId = ?').bind(credential.user.id).first()).n,0);
    return {registration:'passed',login:'passed',registrationReplay:'passed',assertionReplay:'passed',challengeMismatch:'passed',originMismatch:'passed',rpMismatch:'passed',invalidSignature:'passed',removedCredential:'passed',crossUserRemoval:'passed'};
  } finally {await browser.close();}
}
