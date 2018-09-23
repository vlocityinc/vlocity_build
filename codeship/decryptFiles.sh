mkdir codeship/unencrypted_files

for filename in codeship/encrypted_files/*; do

    BASE=`echo "$(basename $filename)"`

    openssl enc -d -aes-256-cbc -pass pass:$AES_KEY -in codeship/encrypted_files/$BASE -out codeship/unencrypted_files/$BASE

    cat codeship/unencrypted_files/$BASE
done