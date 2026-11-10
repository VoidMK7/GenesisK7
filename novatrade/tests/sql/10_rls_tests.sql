-- Behavioural tests for the NovaTrade migrations. Run after the stub and both migrations.
-- Each case runs one statement as a given role/user and compares the outcome with what we expect.
\set ON_ERROR_STOP off
create temp table results (name text, expected text, actual text);

create function pg_temp.t(p_name text, p_role text, p_uid uuid, p_sql text, p_expected text) returns void
language plpgsql as $$
declare n bigint; outcome text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), false);
  execute format('set role %I', p_role);
  begin
    execute p_sql;
    get diagnostics n = row_count;
    outcome := 'rows:' || n;
  exception
    when insufficient_privilege then outcome := 'denied';
    when check_violation then outcome := 'check';
    when unique_violation then outcome := 'unique';
    when raise_exception then outcome := 'raise';
    when others then outcome := 'err:' || sqlstate;
  end;
  reset role;
  insert into results values (p_name, p_expected, outcome);
end $$;

-- fixtures (as superuser)
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@x'), ('bbbbbbbb-0000-0000-0000-000000000002', 'b@x'), ('cccccccc-0000-0000-0000-000000000003', 'admin@x');
insert into public.user_roles values ('cccccccc-0000-0000-0000-000000000003', 'admin');

\set A '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set B '\'bbbbbbbb-0000-0000-0000-000000000002\''
\set ADM '\'cccccccc-0000-0000-0000-000000000003\''

-- 1. settings: defaults, no way to reach live from the browser
select pg_temp.t('A inserts own settings (analysis)', 'authenticated', :A, format('insert into nova_user_settings(user_id) values (%L)', :A), 'rows:1');
select pg_temp.t('A cannot insert settings for B', 'authenticated', :A, format('insert into nova_user_settings(user_id) values (%L)', :B), 'denied');
select pg_temp.t('A cannot insert with live mode', 'authenticated', :A, format('insert into nova_user_settings(user_id, execution_mode) values (%L, ''live'')', 'aaaaaaaa-0000-0000-0000-000000000009'), 'denied');
select pg_temp.t('A switches to paper', 'authenticated', :A, format('update nova_user_settings set execution_mode=''paper'' where user_id=%L', :A), 'rows:1');
select pg_temp.t('A cannot switch to live', 'authenticated', :A, format('update nova_user_settings set execution_mode=''live'' where user_id=%L', :A), 'denied');
select pg_temp.t('A cannot set live_enabled', 'authenticated', :A, format('update nova_user_settings set live_enabled=true where user_id=%L', :A), 'denied');
select pg_temp.t('A cannot set live_unlocked_at', 'authenticated', :A, format('update nova_user_settings set live_unlocked_at=now() where user_id=%L', :A), 'denied');
select pg_temp.t('A can engage emergency stop', 'authenticated', :A, format('update nova_user_settings set emergency_stop=true where user_id=%L', :A), 'rows:1');
select pg_temp.t('B cannot see A settings', 'authenticated', :B, format('select * from nova_user_settings where user_id=%L', :A), 'rows:0');
select pg_temp.t('B update of A settings affects nothing', 'authenticated', :B, format('update nova_user_settings set execution_mode=''analysis'' where user_id=%L', :A), 'rows:0');
select pg_temp.t('server (service_role) can unlock live', 'service_role', null, format('update nova_user_settings set execution_mode=''live'', live_enabled=true, live_unlocked_at=now() where user_id=%L', :A), 'rows:1');
select pg_temp.t('A can downgrade from live to paper', 'authenticated', :A, format('update nova_user_settings set execution_mode=''paper'' where user_id=%L', :A), 'rows:1');
select pg_temp.t('anon sees nothing', 'anon', null, 'select * from nova_user_settings', 'denied');

-- 2. secrets are invisible to browser roles
select pg_temp.t('service inserts secret', 'service_role', null, format('insert into nova_secrets(id,user_id,kind,ciphertext) values (''11111111-1111-1111-1111-111111111111'',%L,''broker'',''v1:x:y:z'')', :A), 'rows:1');
select pg_temp.t('A cannot read secrets', 'authenticated', :A, 'select * from nova_secrets', 'denied');
select pg_temp.t('A cannot insert secrets', 'authenticated', :A, format('insert into nova_secrets(user_id,kind,ciphertext) values (%L,''broker'',''x'')', :A), 'denied');
select pg_temp.t('admin cannot read secrets either', 'authenticated', :ADM, 'select * from nova_secrets', 'denied');
select pg_temp.t('anon cannot read secrets', 'anon', null, 'select * from nova_secrets', 'denied');

-- 3. connections: server writes; withdrawal-capable keys rejected even for the server
select pg_temp.t('service creates connection', 'service_role', null, format('insert into nova_broker_connections(id,user_id,provider,environment,secret_id,withdrawal_permission) values (''22222222-2222-2222-2222-222222222222'',%L,''alpaca'',''paper'',''11111111-1111-1111-1111-111111111111'',false)', :A), 'rows:1');
select pg_temp.t('withdrawal=true is rejected by constraint', 'service_role', null, format('insert into nova_broker_connections(user_id,provider,environment,withdrawal_permission) values (%L,''binance'',''live'',true)', :A), 'check');
select pg_temp.t('withdrawal=unknown (null) is storable (but live stays locked in code)', 'service_role', null, format('insert into nova_broker_connections(user_id,provider,environment,withdrawal_permission) values (%L,''binance'',''live'',null)', :A), 'rows:1');
select pg_temp.t('A reads own connections', 'authenticated', :A, 'select * from nova_broker_connections', 'rows:2');
select pg_temp.t('B sees none of A connections', 'authenticated', :B, 'select * from nova_broker_connections', 'rows:0');
select pg_temp.t('A cannot insert a connection', 'authenticated', :A, format('insert into nova_broker_connections(user_id,provider,environment) values (%L,''alpaca'',''live'')', :A), 'denied');
select pg_temp.t('A cannot edit permissions_verified', 'authenticated', :A, 'update nova_broker_connections set permissions_verified=true', 'denied');

-- 4. audit log: append-only for everyone, owner-readable
select pg_temp.t('service appends audit', 'service_role', null, format('insert into nova_order_audit(user_id,mode,idempotency_key,event) values (%L,''live'',''k1'',''submitted'')', :A), 'rows:1');
select pg_temp.t('audit rejects unknown event', 'service_role', null, format('insert into nova_order_audit(user_id,mode,idempotency_key,event) values (%L,''live'',''k1'',''made_up'')', :A), 'check');
select pg_temp.t('service cannot UPDATE audit', 'service_role', null, 'update nova_order_audit set event=''filled''', 'raise');
select pg_temp.t('service cannot DELETE audit', 'service_role', null, 'delete from nova_order_audit', 'raise');
select pg_temp.t('superuser-level role also cannot delete audit', 'postgres', null, 'delete from nova_order_audit', 'raise');
select pg_temp.t('A reads own audit', 'authenticated', :A, 'select * from nova_order_audit', 'rows:1');
select pg_temp.t('B reads none of A audit', 'authenticated', :B, 'select * from nova_order_audit', 'rows:0');
select pg_temp.t('A cannot forge audit', 'authenticated', :A, format('insert into nova_order_audit(user_id,mode,idempotency_key,event) values (%L,''live'',''k2'',''filled'')', :A), 'denied');
select pg_temp.t('admin can read all audit', 'authenticated', :ADM, 'select * from nova_order_audit', 'rows:1');

-- 5. idempotency key uniqueness
select pg_temp.t('first claim', 'service_role', null, format('insert into nova_order_requests(user_id,idempotency_key) values (%L,''key-1'')', :A), 'rows:1');
select pg_temp.t('duplicate claim blocked', 'service_role', null, format('insert into nova_order_requests(user_id,idempotency_key) values (%L,''key-1'')', :A), 'unique');
select pg_temp.t('same key for another user is fine', 'service_role', null, format('insert into nova_order_requests(user_id,idempotency_key) values (%L,''key-1'')', :B), 'rows:1');

-- 6. strategies: private by default, public only after moderation
select pg_temp.t('service stores strategy', 'service_role', null, format('insert into nova_strategies(id,user_id,engine,symbol,market,name,direction,payload) values (''33333333-3333-3333-3333-333333333333'',%L,''autonomous'',''BTCUSDT'',''crypto'',''Trend'',''long'',''{}'')', :A), 'rows:1');
select pg_temp.t('B cannot see private strategy', 'authenticated', :B, 'select * from nova_strategies', 'rows:0');
select pg_temp.t('A cannot publish own strategy', 'authenticated', :A, 'update nova_strategies set visibility=''public'', moderation=''approved''', 'denied');
select pg_temp.t('public but unmoderated stays hidden', 'service_role', null, 'update nova_strategies set visibility=''public'', moderation=''pending''', 'rows:1');
select pg_temp.t('B still cannot see it', 'authenticated', :B, 'select * from nova_strategies', 'rows:0');
select pg_temp.t('admin approves', 'authenticated', :ADM, 'update nova_strategies set moderation=''approved''', 'rows:1');
select pg_temp.t('B now sees approved public strategy', 'authenticated', :B, 'select * from nova_strategies', 'rows:1');
select pg_temp.t('B cannot edit it', 'authenticated', :B, 'update nova_strategies set name=''x''', 'denied');

-- 7. copy marketplace
select pg_temp.t('A creates public profile', 'authenticated', :A, format('insert into nova_trader_profiles(user_id,display_name,is_public,allow_copy) values (%L,''AlphaTrader'',true,true)', :A), 'rows:1');
select pg_temp.t('display names unique ignoring case', 'authenticated', :B, format('insert into nova_trader_profiles(user_id,display_name) values (%L,''alphatrader'')', :B), 'unique');
select pg_temp.t('B profile private', 'authenticated', :B, format('insert into nova_trader_profiles(user_id,display_name) values (%L,''BetaTrader'')', :B), 'rows:1');
select pg_temp.t('B sees A (public) only plus own', 'authenticated', :B, 'select * from nova_trader_profiles', 'rows:2');
select pg_temp.t('A sees only own (B is private)', 'authenticated', :A, 'select * from nova_trader_profiles', 'rows:1');
select pg_temp.t('service writes stats', 'service_role', null, format('insert into nova_trader_stats(user_id,record_source,trades,days) values (%L,''broker_verified'',50,120)', :A), 'rows:1');
select pg_temp.t('record_source must be a known label', 'service_role', null, format('insert into nova_trader_stats(user_id,record_source) values (%L,''trust_me'')', :B), 'check');
select pg_temp.t('A cannot fake own stats', 'authenticated', :A, format('update nova_trader_stats set trades=9999 where user_id=%L', :A), 'denied');
select pg_temp.t('B can read public A stats', 'authenticated', :B, 'select * from nova_trader_stats', 'rows:1');
select pg_temp.t('cannot follow self', 'authenticated', :A, format('insert into nova_follows(follower,leader) values (%L,%L)', :A, :A), 'check');
select pg_temp.t('B follows A', 'authenticated', :B, format('insert into nova_follows(follower,leader) values (%L,%L)', :B, :A), 'rows:1');
select pg_temp.t('B cannot create a follow as A', 'authenticated', :B, format('insert into nova_follows(follower,leader) values (%L,%L)', :A, :B), 'denied');
select pg_temp.t('service starts copy', 'service_role', null, format('insert into nova_copy_subscriptions(follower,leader,allocation) values (%L,%L,500)', :B, :A), 'rows:1');
select pg_temp.t('only one active copy per pair', 'service_role', null, format('insert into nova_copy_subscriptions(follower,leader,allocation) values (%L,%L,500)', :B, :A), 'unique');
select pg_temp.t('allocation must be positive', 'service_role', null, format('insert into nova_copy_subscriptions(follower,leader,allocation,status) values (%L,%L,0,''stopped'')', :A, :B), 'check');
select pg_temp.t('B cannot edit own copy subscription (server only)', 'authenticated', :B, 'update nova_copy_subscriptions set allocation=999999', 'denied');
select pg_temp.t('A (leader) cannot see follower subscriptions', 'authenticated', :A, 'select * from nova_copy_subscriptions', 'rows:0');

-- 8. notifications: owner can only flip "read"
select pg_temp.t('service notifies', 'service_role', null, format('insert into nova_notifications(user_id,kind,title) values (%L,''risk'',''Blocked'')', :A), 'rows:1');
select pg_temp.t('A marks read', 'authenticated', :A, 'update nova_notifications set read=true', 'rows:1');
select pg_temp.t('A cannot rewrite title', 'authenticated', :A, 'update nova_notifications set title=''x''', 'denied');
select pg_temp.t('B sees none', 'authenticated', :B, 'select * from nova_notifications', 'rows:0');

-- 9. admin-only: training centre, platform config, security events
select pg_temp.t('A cannot read knowledge', 'authenticated', :A, 'select * from nova_knowledge_sources', 'rows:0');
select pg_temp.t('A cannot add knowledge', 'authenticated', :A, 'insert into nova_knowledge_sources(title,kind) values (''x'',''text'')', 'denied');
select pg_temp.t('admin adds knowledge', 'authenticated', :ADM, 'insert into nova_knowledge_sources(title,kind) values (''Risk book'',''text'')', 'rows:1');
select pg_temp.t('new knowledge starts pending_review', 'authenticated', :ADM, 'select * from nova_knowledge_sources where status=''pending_review''', 'rows:1');
select pg_temp.t('knowledge status is constrained', 'authenticated', :ADM, 'update nova_knowledge_sources set status=''auto_trained''', 'check');
select pg_temp.t('A cannot read platform config', 'authenticated', :A, 'select * from nova_platform_config', 'rows:0');
select pg_temp.t('A cannot write platform config', 'authenticated', :A, 'insert into nova_platform_config(key,value) values (''k'',''1'')', 'denied');
select pg_temp.t('admin writes platform config', 'authenticated', :ADM, 'insert into nova_platform_config(key,value) values (''watchlist'',''[]'')', 'rows:1');
select pg_temp.t('service logs security event', 'service_role', null, format('insert into nova_security_events(user_id,kind) values (%L,''live_enabled'')', :A), 'rows:1');
select pg_temp.t('A cannot read security events', 'authenticated', :A, 'select * from nova_security_events', 'rows:0');
select pg_temp.t('admin reads security events', 'authenticated', :ADM, 'select * from nova_security_events', 'rows:1');
select pg_temp.t('only one active knowledge version', 'service_role', null, 'insert into nova_knowledge_versions(note,snapshot,is_active) values (''v1'',''{}'',true),(''v2'',''{}'',true)', 'unique');
select pg_temp.t('A cannot upload to training bucket', 'authenticated', :A, 'insert into storage.objects(bucket_id,name) values (''nova-training'',''a.pdf'')', 'denied');
select pg_temp.t('admin can upload to training bucket', 'authenticated', :ADM, 'insert into storage.objects(bucket_id,name) values (''nova-training'',''a.pdf'')', 'rows:1');

-- 10. paper ledger and risk limits
select pg_temp.t('A cannot print paper money', 'authenticated', :A, format('insert into nova_paper_accounts(user_id,cash,start_cash) values (%L,1000000,1000000)', :A), 'denied');
select pg_temp.t('service opens paper account', 'service_role', null, format('insert into nova_paper_accounts(user_id,cash,start_cash) values (%L,10000,10000)', :A), 'rows:1');
select pg_temp.t('paper cash cannot go negative', 'service_role', null, format('update nova_paper_accounts set cash=-1 where user_id=%L', :A), 'check');
select pg_temp.t('A sets own risk limits', 'authenticated', :A, format('insert into nova_risk_limits(user_id,max_order_value,daily_loss_limit) values (%L,500,100)', :A), 'rows:1');
select pg_temp.t('risk limits validated', 'authenticated', :A, format('update nova_risk_limits set max_position_pct=150 where user_id=%L', :A), 'check');
select pg_temp.t('B cannot touch A risk limits', 'authenticated', :B, format('update nova_risk_limits set max_order_value=1e9 where user_id=%L', :A), 'rows:0');

\echo
\echo ===== RESULTS =====
select case when expected = actual then 'PASS' else 'FAIL' end as result, name, expected, actual from results order by (expected = actual), name;
select count(*) filter (where expected = actual) as passed, count(*) filter (where expected <> actual) as failed, count(*) as total from results;
