# Small RAR regression fixtures

These four small archives are copied unmodified from the MIT-licensed
[node-unrar.js testFiles](https://github.com/YuJianrong/node-unrar.js/tree/8c615868c9e2ec5ef2e661c5bcaee20ffad3862c/testFiles).
Upstream commit: `8c615868c9e2ec5ef2e661c5bcaee20ffad3862c`.
Copyright Jianrong Yu; the upstream MIT notice is in `resources/licenses/node-unrar-js.txt`.

`HeaderEnc1234.rar` uses the public test password `1234`.
The archives cover comments, Unicode paths, directories, header encryption and file encryption.
The private 300 MB M0 sample is never committed; enable it explicitly using `AVCA_INTAKE_FIXTURES`.
