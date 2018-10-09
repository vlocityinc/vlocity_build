#!/usr/bin/env bash 

rm -rf codeship/unencrypted_temp
mkdir codeship/unencrypted_temp

for filename in codeship/unencrypted_env/*; do
    BASE=`echo "$(basename $filename)"`
    CONVERTED=`echo "${BASE/./_DOT_}"`
    echo "$CONVERTED=`cat $filename`" >> codeship/unencrypted_temp/env_all_generated.txt
done

jet encrypt codeship/unencrypted_temp/env_all_generated.txt codeship/env.encrypted
rm -f codeship/unencrypted_temp/env_all_generated.txt

mkdir -p codeship/encrypted_files
for filename in codeship/unencrypted_files/*; do
    BASE=`echo "$(basename $filename)"`

    openssl enc -aes-256-cbc -pass file:codeship.aes -in codeship/unencrypted_files/${BASE} -out codeship/encrypted_files/${BASE}
done


