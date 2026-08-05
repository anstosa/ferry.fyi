const verifyDynamicAliasImport = async (): Promise<void> => {
  const { isTrustedAdMutationOrigin } = await import("~/lib/adOrigin");
  if (
    !isTrustedAdMutationOrigin(
      "https://dev.ferry.fyi",
      "https://dev.ferry.fyi"
    )
  ) {
    throw new Error("Deferred alias import returned an invalid module");
  }
  process.stdout.write("dynamic-alias-ok");
};

verifyDynamicAliasImport().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
