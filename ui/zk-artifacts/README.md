ZK artifacts for the `register` and `vote` circuits, copied from the build that deployed the Wave 3 test poll
(`a0164789…768c` on Preview, compact 0.31.1). The vote page's dev server serves these under `/zk` first, so a
member's machine doesn't need a full ZK compile and the proving keys match the deployed verifier keys exactly.
Check them with `sha256sum -c SHA256SUMS`.
