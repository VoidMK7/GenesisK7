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

-- uses the users created by 10_rls_tests.sql (same database)

\set A '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set B '\'bbbbbbbb-0000-0000-0000-000000000002\''
\set ADM '\'cccccccc-0000-0000-0000-000000000003\''

-- profiles
select pg_temp.t('A creates profile', 'authenticated', :A, format('insert into nova_profiles(user_id,handle,display_name) values (%L,''alice'',''Alice'')', :A), 'rows:1');
select pg_temp.t('A cannot create profile for B', 'authenticated', :A, format('insert into nova_profiles(user_id,handle,display_name) values (%L,''fake'',''Fake'')', :B), 'denied');
select pg_temp.t('B creates profile', 'authenticated', :B, format('insert into nova_profiles(user_id,handle,display_name) values (%L,''bob'',''Bob'')', :B), 'rows:1');
select pg_temp.t('handle unique', 'authenticated', :B, format('update nova_profiles set handle=''alice'' where user_id=%L', :B), 'unique');
select pg_temp.t('handle must be lowercase', 'authenticated', :B, format('update nova_profiles set handle=''ALICE'' where user_id=%L', :B), 'check');
select pg_temp.t('bad handle rejected', 'authenticated', :B, format('update nova_profiles set handle=''a b'' where user_id=%L', :B), 'check');
select pg_temp.t('banner 8s video ok', 'authenticated', :A, format('update nova_profiles set banner_url=''https://x/b.mp4'', banner_kind=''video'', banner_seconds=8 where user_id=%L', :A), 'rows:1');
select pg_temp.t('banner 12s video rejected', 'authenticated', :A, format('update nova_profiles set banner_seconds=12 where user_id=%L', :A), 'check');
select pg_temp.t('banner url needs kind', 'authenticated', :A, format('update nova_profiles set banner_kind=null where user_id=%L', :A), 'check');
select pg_temp.t('B cannot edit A profile', 'authenticated', :B, format('update nova_profiles set bio=''hacked'' where user_id=%L', :A), 'rows:0');
select pg_temp.t('B can read A profile', 'authenticated', :B, format('select * from nova_profiles where user_id=%L', :A), 'rows:1');
select pg_temp.t('anon cannot read profiles', 'anon', null, 'select * from nova_profiles', 'denied');

-- follows / posts / likes
select pg_temp.t('A follows B', 'authenticated', :A, format('insert into nova_social_follows values (%L,%L)', :A, :B), 'rows:1');
select pg_temp.t('A cannot follow as B', 'authenticated', :A, format('insert into nova_social_follows values (%L,%L)', :B, :A), 'denied');
select pg_temp.t('cannot follow self', 'authenticated', :A, format('insert into nova_social_follows values (%L,%L)', :A, :A), 'check');
select pg_temp.t('A posts', 'authenticated', :A, format('insert into nova_posts(author,body) values (%L,''gm'')', :A), 'rows:1');
select pg_temp.t('A cannot post as B', 'authenticated', :A, format('insert into nova_posts(author,body) values (%L,''spoof'')', :B), 'denied');
select pg_temp.t('A cannot attach a trade_id directly', 'authenticated', :A, format('insert into nova_posts(author,body,trade_id) values (%L,''x'',gen_random_uuid())', :A), 'denied');
select pg_temp.t('empty post rejected', 'authenticated', :A, format('insert into nova_posts(author,body) values (%L,'''')', :A), 'check');
select pg_temp.t('B likes A post', 'authenticated', :B, format('insert into nova_post_likes select id, %L from nova_posts where author=%L', :B, :A), 'rows:1');
select pg_temp.t('double like rejected', 'authenticated', :B, format('insert into nova_post_likes select id, %L from nova_posts where author=%L', :B, :A), 'unique');
select pg_temp.t('B cannot like as A', 'authenticated', :B, format('insert into nova_post_likes select id, %L from nova_posts where author=%L', :A, :A), 'denied');
select pg_temp.t('post stats count the like', 'authenticated', :A, 'select 1 from nova_post_stats where likes = 1', 'rows:1');
select pg_temp.t('B cannot edit A post body', 'authenticated', :B, 'update nova_posts set body=''x''', 'denied');
select pg_temp.t('B cannot delete A post', 'authenticated', :B, format('delete from nova_posts where author=%L', :A), 'rows:0');
select pg_temp.t('admin hides a post', 'authenticated', :ADM, 'update nova_posts set hidden=true', 'rows:1');
select pg_temp.t('B no longer sees hidden post', 'authenticated', :B, format('select * from nova_posts where author=%L', :A), 'rows:0');
select pg_temp.t('profile counts visible', 'authenticated', :B, format('select * from nova_profile_counts where user_id=%L and followers=1', :B), 'rows:1');

-- rooms: server creates; members read; strangers cannot read private or write
insert into nova_rooms(id, kind, slug, name, is_public) values ('dddddddd-0000-0000-0000-00000000000a','community','open-room','Open room', true), ('dddddddd-0000-0000-0000-00000000000b','community','private-room','Private room', false);
insert into nova_room_members(room_id,user_id,role) values ('dddddddd-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001','owner'), ('dddddddd-0000-0000-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-000000000001','owner');
select pg_temp.t('A cannot create rooms directly', 'authenticated', :A, 'insert into nova_rooms(kind,slug,name) values (''community'',''hack-room'',''Hack room'')', 'denied');
select pg_temp.t('A cannot add self to rooms directly', 'authenticated', :B, format('insert into nova_room_members(room_id,user_id) values (''dddddddd-0000-0000-0000-00000000000b'',%L)', :B), 'denied');
select pg_temp.t('B sees only the public room', 'authenticated', :B, 'select * from nova_rooms', 'rows:1');
select pg_temp.t('A sends in own room', 'authenticated', :A, format('insert into nova_messages(room_id,sender,body) values (''dddddddd-0000-0000-0000-00000000000b'',%L,''hi'')', :A), 'rows:1');
select pg_temp.t('B cannot send in private room', 'authenticated', :B, format('insert into nova_messages(room_id,sender,body) values (''dddddddd-0000-0000-0000-00000000000b'',%L,''let me in'')', :B), 'denied');
select pg_temp.t('B cannot read private messages', 'authenticated', :B, 'select * from nova_messages where room_id=''dddddddd-0000-0000-0000-00000000000b''', 'rows:0');
select pg_temp.t('A cannot spoof sender', 'authenticated', :A, format('insert into nova_messages(room_id,sender,body) values (''dddddddd-0000-0000-0000-00000000000a'',%L,''spoof'')', :B), 'denied');
select pg_temp.t('messages are not editable', 'authenticated', :A, 'update nova_messages set body=''edited''', 'denied');

-- wallets are read-only records, written by the server
select pg_temp.t('A cannot insert a wallet directly', 'authenticated', :A, format('insert into nova_wallets(user_id,chain,address) values (%L,''solana'',''So11111111111111111111111111111111111111112'')', :A), 'denied');
select pg_temp.t('server inserts wallet', 'service_role', null, format('insert into nova_wallets(id,user_id,chain,address) values (''eeeeeeee-0000-0000-0000-00000000000a'',%L,''solana'',''So11111111111111111111111111111111111111112'')', :A), 'rows:1');
select pg_temp.t('B cannot see A wallet', 'authenticated', :B, 'select * from nova_wallets', 'rows:0');
select pg_temp.t('A sees own wallet', 'authenticated', :A, 'select * from nova_wallets', 'rows:1');
select pg_temp.t('A cannot forge a balance', 'authenticated', :A, format('insert into nova_wallet_snapshots(wallet_id,user_id,native_symbol,native_balance,source) values (''eeeeeeee-0000-0000-0000-00000000000a'',%L,''SOL'',999,''x'')', :A), 'denied');
select pg_temp.t('A sets allocation on own wallet', 'authenticated', :A, format('insert into nova_allocations(wallet_id,user_id,enabled,mode,percent) values (''eeeeeeee-0000-0000-0000-00000000000a'',%L,true,''percent'',25)', :A), 'rows:1');
select pg_temp.t('allocation percent capped at 100', 'authenticated', :A, format('update nova_allocations set percent=150 where user_id=%L', :A), 'check');
select pg_temp.t('B cannot set allocation on A wallet', 'authenticated', :B, format('insert into nova_allocations(wallet_id,user_id) values (''eeeeeeee-0000-0000-0000-00000000000a'',%L)', :B), 'denied');
select pg_temp.t('B cannot read A allocation', 'authenticated', :B, 'select * from nova_allocations', 'rows:0');

-- strategy: browser cannot select live_approval on insert; positions and trade log are server-only
select pg_temp.t('A saves strategy (paper)', 'authenticated', :A, format('insert into nova_meme_strategy(user_id,prompt,mode) values (%L,''buy momentum'',''paper'')', :A), 'rows:1');
select pg_temp.t('stop loss must be below 100%', 'authenticated', :A, format('update nova_meme_strategy set stop_loss_pct=100 where user_id=%L', :A), 'check');
select pg_temp.t('A cannot move strategy to live_approval via browser', 'authenticated', :A, format('update nova_meme_strategy set mode=''live_approval'' where user_id=%L', :A), 'denied');
select pg_temp.t('A cannot touch last_cycle_at', 'authenticated', :A, format('update nova_meme_strategy set last_cycle_at=now() where user_id=%L', :A), 'denied');
select pg_temp.t('B strategy invisible to A', 'authenticated', :B, format('insert into nova_meme_strategy(user_id,mode) values (%L,''live_approval'')', :B), 'denied');
select pg_temp.t('server writes position', 'service_role', null, format('insert into nova_meme_positions(id,user_id,mode,chain,token_address,symbol,entry_price,qty,cost_usd,peak_price,stop_loss_pct,trailing_stop_pct,take_profit_pct) values (''ffffffff-0000-0000-0000-00000000000a'',%L,''paper'',''solana'',''MINT1'',''PEPE2'',0.01,5000,50,0.01,25,20,100)', :A), 'rows:1');
select pg_temp.t('A cannot write a position', 'authenticated', :A, format('insert into nova_meme_positions(user_id,mode,chain,token_address,symbol,entry_price,qty,cost_usd,peak_price,stop_loss_pct,trailing_stop_pct,take_profit_pct) values (%L,''paper'',''solana'',''X'',''X'',1,1,1,1,1,1,1)', :A), 'denied');
select pg_temp.t('A reads own position', 'authenticated', :A, 'select * from nova_meme_positions', 'rows:1');
select pg_temp.t('B cannot read A position', 'authenticated', :B, 'select * from nova_meme_positions', 'rows:0');
select pg_temp.t('server logs a simulated buy', 'service_role', null, format('insert into nova_trade_log(id,user_id,mode,agent,side,chain,token_address,symbol,status,reason) values (''99999999-0000-0000-0000-00000000000a'',%L,''paper'',''executor'',''buy'',''solana'',''MINT1'',''PEPE2'',''simulated_fill'',''why'')', :A), 'rows:1');
select pg_temp.t('log: cannot claim confirmed without tx', 'service_role', null, format('insert into nova_trade_log(user_id,mode,agent,side,chain,token_address,symbol,status,reason,simulated) values (%L,''live'',''executor'',''buy'',''solana'',''M'',''M'',''confirmed'',''x'',false)', :A), 'check');
select pg_temp.t('log: simulated can never be confirmed', 'service_role', null, format('insert into nova_trade_log(user_id,mode,agent,side,chain,token_address,symbol,status,reason,tx_signature,simulated) values (%L,''paper'',''executor'',''buy'',''solana'',''M'',''M'',''confirmed'',''x'',''sig'',true)', :A), 'check');
select pg_temp.t('log: A cannot write', 'authenticated', :A, format('insert into nova_trade_log(user_id,mode,agent,side,chain,token_address,symbol,status,reason) values (%L,''paper'',''user'',''buy'',''solana'',''M'',''M'',''simulated_fill'',''forged'')', :A), 'denied');
select pg_temp.t('log: A reads own', 'authenticated', :A, 'select * from nova_trade_log', 'rows:1');
select pg_temp.t('log: B reads none', 'authenticated', :B, 'select * from nova_trade_log', 'rows:0');
select pg_temp.t('log: append-only (update)', 'service_role', null, 'update nova_trade_log set reason=''rewritten''', 'raise');
select pg_temp.t('log: append-only (delete)', 'service_role', null, 'delete from nova_trade_log', 'raise');
select pg_temp.t('A thumbs-up own trade', 'authenticated', :A, format('insert into nova_trade_feedback(trade_id,user_id,rating) values (''99999999-0000-0000-0000-00000000000a'',%L,1)', :A), 'rows:1');
select pg_temp.t('B cannot rate A trade', 'authenticated', :B, format('insert into nova_trade_feedback(trade_id,user_id,rating) values (''99999999-0000-0000-0000-00000000000a'',%L,-1)', :B), 'denied');
select pg_temp.t('rating must be +-1', 'authenticated', :A, format('update nova_trade_feedback set rating=5 where user_id=%L', :A), 'check');

-- teaching rules and AI chat
select pg_temp.t('A teaches a rule', 'authenticated', :A, format('insert into nova_ai_rules(user_id,kind,text) values (%L,''avoid'',''Never buy tokens under 1 hour old'')', :A), 'rows:1');
select pg_temp.t('B cannot see A rules', 'authenticated', :B, 'select * from nova_ai_rules', 'rows:0');
select pg_temp.t('B cannot edit A rules', 'authenticated', :B, 'update nova_ai_rules set active=false', 'rows:0');
select pg_temp.t('A cannot forge assistant messages', 'authenticated', :A, format('insert into nova_ai_messages(user_id,role,body) values (%L,''assistant'',''fake'')', :A), 'denied');
select pg_temp.t('server stores assistant message', 'service_role', null, format('insert into nova_ai_messages(user_id,role,body) values (%L,''assistant'',''hello'')', :A), 'rows:1');
select pg_temp.t('A reads own chat', 'authenticated', :A, 'select * from nova_ai_messages', 'rows:1');
select pg_temp.t('B cannot read A chat', 'authenticated', :B, 'select * from nova_ai_messages', 'rows:0');

-- agents page
select pg_temp.t('A cannot insert external traders', 'authenticated', :A, 'insert into nova_external_traders(platform,handle,chain,source) values (''fomo'',''x'',''solana'',''me'')', 'denied');
select pg_temp.t('server inserts external trader', 'service_role', null, 'insert into nova_external_traders(platform,handle,chain,source) values (''fomo'',''x'',''solana'',''feed'')', 'rows:1');
select pg_temp.t('A reads external traders', 'authenticated', :A, 'select * from nova_external_traders', 'rows:1');

-- storage policies
insert into storage.objects(bucket_id, name, owner) values ('nova-media', 'aaaaaaaa-0000-0000-0000-000000000001/avatar.png', null);
select pg_temp.t('A uploads into own folder', 'authenticated', :A, format('insert into storage.objects(bucket_id,name) values (''nova-media'',''%s/banner.mp4'')', 'aaaaaaaa-0000-0000-0000-000000000001'), 'rows:1');
select pg_temp.t('A cannot upload into B folder', 'authenticated', :A, format('insert into storage.objects(bucket_id,name) values (''nova-media'',''%s/evil.png'')', 'bbbbbbbb-0000-0000-0000-000000000002'), 'denied');
select pg_temp.t('A cannot delete B files', 'authenticated', :A, 'delete from storage.objects where name like ''bbbbbbbb%''', 'rows:0');

-- following top traders
select pg_temp.t('A sets autofollow', 'authenticated', :A, format('insert into nova_autofollow(user_id,enabled) values (%L,true)', :A), 'rows:1');
select pg_temp.t('autofollow win rate bounded', 'authenticated', :A, format('update nova_autofollow set min_win_rate_pct=120 where user_id=%L', :A), 'check');
select pg_temp.t('B cannot edit A autofollow', 'authenticated', :B, 'update nova_autofollow set enabled=false', 'rows:0');
select pg_temp.t('A cannot insert a followed trader', 'authenticated', :A, format('insert into nova_followed_traders(user_id,chain,wallet_address,handle,source) values (%L,''solana'',''So11111111111111111111111111111111111111112'',''x'',''manual'')', :A), 'denied');
select pg_temp.t('server inserts followed trader', 'service_role', null, format('insert into nova_followed_traders(user_id,chain,wallet_address,handle,source,reason) values (%L,''solana'',''So11111111111111111111111111111111111111112'',''whale'',''auto'',''64%% win rate'')', :A), 'rows:1');
select pg_temp.t('server stores observed trade', 'service_role', null, 'insert into nova_observed_trades(chain,wallet_address,signature,side,token_address,token_amount,quote,quote_amount) values (''solana'',''So11111111111111111111111111111111111111112'',''sig1'',''buy'',''M1'',1000,''SOL'',1.5)', 'rows:1');
select pg_temp.t('same signature twice is rejected', 'service_role', null, 'insert into nova_observed_trades(chain,wallet_address,signature,side,token_address,token_amount,quote,quote_amount) values (''solana'',''So11111111111111111111111111111111111111112'',''sig1'',''buy'',''M1'',1000,''SOL'',1.5)', 'unique');
select pg_temp.t('follower sees the observed trade', 'authenticated', :A, 'select * from nova_observed_trades', 'rows:1');
select pg_temp.t('non-follower sees nothing', 'authenticated', :B, 'select * from nova_observed_trades', 'rows:0');
select pg_temp.t('browser cannot read watch cursors', 'authenticated', :A, 'select * from nova_watch_cursors', 'denied');
select pg_temp.t('server alerts once per trade', 'service_role', null, format('insert into nova_trade_alerts(user_id,observed_id) select %L, id from nova_observed_trades', :A), 'rows:1');
select pg_temp.t('duplicate alert rejected', 'service_role', null, format('insert into nova_trade_alerts(user_id,observed_id) select %L, id from nova_observed_trades', :A), 'unique');
select pg_temp.t('A unfollows', 'authenticated', :A, 'delete from nova_followed_traders', 'rows:1');
select pg_temp.t('after unfollow A no longer sees trades', 'authenticated', :A, 'select * from nova_observed_trades', 'rows:0');

\echo
\echo ===== RESULTS =====
select case when expected = actual then 'PASS' else 'FAIL' end as result, name, expected, actual from results order by (expected = actual), name;
select count(*) filter (where expected = actual) as passed, count(*) filter (where expected <> actual) as failed, count(*) as total from results;
