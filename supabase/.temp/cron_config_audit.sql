select jsonb_build_object(
  'cron_config_rows', (select count(*) from public.cron_config),
  'secret_like_key_rows', (select count(*) from public.cron_config where name ~* '(secret|token|key|password|authorization)'),
  'empty_secret_like_values', (select count(*) from public.cron_config where name ~* '(secret|token|key|password|authorization)' and nullif(btrim(value),'') is null),
  'commands_using_cron_config', (select count(*) from cron.job where command ~* 'cron_config'),
  'commands_using_vault', (select count(*) from cron.job where command ~* 'vault\\.'),
  'commands_with_literal_bearer', (select count(*) from cron.job where command ~* 'bearer[[:space:]]+[a-z0-9._-]{20,}'),
  'commands_with_authorization_header', (select count(*) from cron.job where command ~* 'authorization')
);
