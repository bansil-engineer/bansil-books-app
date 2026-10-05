"""Official Antigravity SDK JSONL bridge; stdout is protocol only."""
import asyncio, contextlib, json, os, signal, sys, uuid
OUT=sys.stdout; MAX=100000
def emit(value):
    text=json.dumps(value,ensure_ascii=False)
    if len(text.encode())>MAX: raise ValueError('message too large')
    OUT.write(text+'\n'); OUT.flush()
async def approve(call):
    async with lock:
        ident=str(uuid.uuid4()); name=getattr(call.name,'value',call.name)
        emit({'type':'approval','id':ident,'name':name,'args':call.args})
        line=await asyncio.to_thread(sys.stdin.readline,MAX+1)
        if not line or len(line)>MAX:return False
        answer=json.loads(line);return answer.get('id')==ident and answer.get('allow') is True
def configuration():
    from google.antigravity import LocalAgentConfig
    from google.antigravity.types import CapabilitiesConfig,BuiltinTools,RunCommandConfig
    from google.antigravity.hooks import policy
    return LocalAgentConfig(system_instructions=('Work only on the approved task in the current project. Read AGENTS.md and MODULE_LOCK.md. Preserve unrelated work. Never reset, stash, clean, read credentials, touch data/.env/token files, deploy, or change the orchestrator. Every tool needs owner approval. Report files changed and tests actually run. Write the execution report and user-facing explanations in Gujarati while preserving code, commands, paths, identifiers, API names, enum values, and error text exactly.'),capabilities=CapabilitiesConfig(enabled_tools=BuiltinTools.minimal(),run_command_config=RunCommandConfig(enable_daemons=False,timeout_seconds=120)),policies=[policy.ask_user('*',handler=approve)])
async def main():
    global lock; lock=asyncio.Lock(); from google.antigravity import Agent
    cfg=configuration()
    if '--check' in sys.argv:emit({'type':'check','ok':True});return
    line=sys.stdin.readline(MAX+1)
    if not line or len(line)>MAX:raise ValueError('invalid request')
    request=json.loads(line)
    if not isinstance(request.get('prompt'),str) or not request['prompt'].strip():raise ValueError('missing prompt')
    parent=int(os.environ.get('ORCHESTRATOR_PARENT_PID',os.getppid()))
    if os.getppid()!=parent:raise RuntimeError('parent unavailable')
    async def watch():
        while True:
            await asyncio.sleep(1)
            if os.getppid()!=parent:os.killpg(os.getpgrp(),signal.SIGKILL)
    watcher=asyncio.create_task(watch())
    try:
        async with Agent(cfg) as agent:
            response=await agent.chat(request['prompt']);emit({'type':'result','report':await response.text()})
    finally:watcher.cancel()
if __name__=='__main__':
    try:
        with contextlib.redirect_stdout(sys.stderr):asyncio.run(main())
    except Exception as exc:
        secret=os.environ.get('GEMINI_API_KEY','')
        message=str(exc)
        if secret:message=message.replace(secret,'[REDACTED]')
        emit({'type':'error','message':f'{type(exc).__name__}: {message[:500]}'});sys.exit(1)
