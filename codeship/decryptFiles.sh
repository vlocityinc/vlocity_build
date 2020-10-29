mkdir codeship/unencrypted_files

for filename in codeship/encrypted_files/*; do

    BASE=`echo "$(basename $filename)"`

    jet decrypt codeship/encrypted_files/$BASE codeship/unencrypted_files/$BASE
done