#!/bin/sh
# Cria um banco e um usuário para cada microsserviço (banco por serviço).
# Roda uma única vez, quando o volume do Postgres ainda está vazio.
#
# - Cada usuário só conecta no próprio banco: o payment-service não enxerga
#   os dados do notification-service, e vice-versa (privilégio mínimo).
# - Cada serviço ganha também um banco "<nome>_shadow", que o Prisma usa
#   como rascunho para gerar migrações (prisma migrate dev). Assim o usuário
#   não precisa da permissão de criar bancos.
set -eu

# Para logo no início se alguma variável estiver vazia. Sem isso, o Postgres
# poderia subir "saudável" e sem os bancos.
: "${PAYMENT_DB_NAME:?}" "${PAYMENT_DB_USER:?}" "${PAYMENT_DB_PASSWORD:?}"
: "${NOTIFICATION_DB_NAME:?}" "${NOTIFICATION_DB_USER:?}" "${NOTIFICATION_DB_PASSWORD:?}"

create_service_db() {
  db_name="$1"
  db_user="$2"
  db_password="$3"

  echo "Criando os bancos '$db_name' e '${db_name}_shadow' do usuário '$db_user'"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    -v db_name="$db_name" -v shadow_name="${db_name}_shadow" \
    -v db_user="$db_user" -v db_password="$db_password" <<'SQL'
CREATE ROLE :"db_user" LOGIN PASSWORD :'db_password';
CREATE DATABASE :"db_name" OWNER :"db_user";
CREATE DATABASE :"shadow_name" OWNER :"db_user";
-- Ninguém além do dono (e do administrador) conecta nestes bancos
REVOKE CONNECT ON DATABASE :"db_name" FROM PUBLIC;
REVOKE CONNECT ON DATABASE :"shadow_name" FROM PUBLIC;
SQL
}

create_service_db "$PAYMENT_DB_NAME" "$PAYMENT_DB_USER" "$PAYMENT_DB_PASSWORD"
create_service_db "$NOTIFICATION_DB_NAME" "$NOTIFICATION_DB_USER" "$NOTIFICATION_DB_PASSWORD"

# O banco padrão "postgres" fica só para o administrador
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -c 'REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;'
