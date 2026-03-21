import { Controller, Get, Header } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';

const RESET_PASSWORD_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Reset Password - Trustopay</title>
  <style>
    *{box-sizing:border-box}body{font-family:system-ui,sans-serif;max-width:400px;margin:40px auto;padding:24px;background:#0A192F;color:#fff;min-height:100vh}
    h2{color:#fff;margin-bottom:8px}
    p{color:#A78BFA;margin-bottom:24px;line-height:1.5}
    input{width:100%;padding:12px 16px;border-radius:8px;border:1px solid #E5E7EB;font-size:16px;margin-bottom:16px}
    button{width:100%;padding:14px;background:#7C3AED;color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer}
    button:disabled{opacity:0.7;cursor:not-allowed}
    .error{color:#EF4444;margin-bottom:16px}
    .success{color:#16A34A;margin-bottom:16px}
  </style>
</head>
<body>
  <div id="app">
    <h2>Reset Password</h2>
    <p id="msg">Loading...</p>
    <form id="form" style="display:none">
      <input type="password" id="password" placeholder="New password" minlength="6" required>
      <input type="password" id="confirm" placeholder="Confirm password" minlength="6" required>
      <p id="err" class="error" style="display:none"></p>
      <button type="submit" id="btn">Reset password</button>
    </form>
    <div id="done" style="display:none">
      <p class="success">Password reset successfully! Open the Trustopay app to sign in.</p>
    </div>
    <div id="invalid" style="display:none">
      <p class="error">Invalid or expired link. Please request a new reset link from the app.</p>
    </div>
  </div>
  <script>
    (function(){
      var hash = window.location.hash.slice(1);
      var params = {};
      hash.split('&').forEach(function(p){
        var kv = p.split('=');
        if(kv[0]) params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]||'');
      });
      var token = params.access_token;
      var type = params.type;
      var msg = document.getElementById('msg');
      var form = document.getElementById('form');
      var done = document.getElementById('done');
      var invalid = document.getElementById('invalid');
      if(!token || type !== 'recovery'){
        msg.style.display='none';
        invalid.style.display='block';
        return;
      }
      msg.textContent = 'Enter your new password below.';
      msg.style.display='block';
      form.style.display='block';
      form.onsubmit = function(e){
        e.preventDefault();
        var pwd = document.getElementById('password').value;
        var conf = document.getElementById('confirm').value;
        var err = document.getElementById('err');
        var btn = document.getElementById('btn');
        err.style.display='none';
        if(pwd.length<6){err.textContent='Password must be at least 6 characters';err.style.display='block';return}
        if(pwd!==conf){err.textContent='Passwords do not match';err.style.display='block';return}
        btn.disabled=true;
        btn.textContent='Resetting...';
        fetch('/auth/reset-password',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({access_token:token,new_password:pwd})
        }).then(function(r){return r.json().then(function(d){return{r:r,d:d}}) })
        .then(function(x){
          if(x.r.ok){
            form.style.display='none';
            msg.style.display='none';
            done.style.display='block';
          }else{
            err.textContent = x.d.message || 'Failed to reset password';
            err.style.display='block';
            btn.disabled=false;
            btn.textContent='Reset password';
          }
        }).catch(function(){
          err.textContent='Network error. Please try again.';
          err.style.display='block';
          btn.disabled=false;
          btn.textContent='Reset password';
        });
      };
    })();
  </script>
</body>
</html>`;

@Controller()
@SkipThrottle()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('reset-password')
  @Header('Content-Type', 'text/html')
  getResetPasswordPage(): string {
    return RESET_PASSWORD_HTML;
  }

  @Get('health')
  health(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
