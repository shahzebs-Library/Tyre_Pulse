#!/bin/bash
# fresh.sh <db> [template]  - recreate a disposable clone
psql -h localhost -p 54417 -U supabase_admin -d postgres -qc "drop database if exists $1 with (force)" -c "create database $1 template ${2:-rh_a} owner postgres"
