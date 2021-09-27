# @guardian/actions-assume-aws-role

This is a [GitHub Action][action] for use during [CI].
Use it to gain temporary credentials to AWS [by exchanging GitHub OIDC credentials for AWS IAM Assume Role][aws-docs] using an `AWS::IAM::OIDCProvider`.

## Set up
[This blog][awsteele] provides a lot of detail.

In short, you first need to create three resources:
  1. AWS::IAM::Policy
  2. AWS::IAM::Role
  3. AWS::IAM::OIDCProvider

We recommend doing this via CloudFormation.

If you're using [@guardian/cdk] you can use the `GuGithubActionsRole` construct:

```typescript
new GuGithubActionsRole(stack, {
  policies: [
    // Just an example, customise as needed.
    new GuAllowPolicy(stack, "GitHubBucketAccessPolicy", {
      actions: ["s3:Put*"],
      resources: ["arn:aws:s3:::/build-artifacts/*"],
    }),
  ],
});
```

If you're using writing CloudFormation in YAML, the resources you need will look something like this:

```yaml
Resources:
  # Resources to provide S3 upload permissions to GitHub Actions.
  # Permissions are scoped to Riff-Raff buckets.
  # See https://github.com/guardian/actions-assume-aws-role
  GitHubBucketAccessPolicy:
    Type: AWS::IAM::Policy
    Properties:
      PolicyName: GitHubBucketAccessPolicy
      PolicyDocument:
        Statement:
          Effect: Allow
          Action:
            - s3:Put* # Just an example, customise as needed.
          Resource:
            - !Sub arn:aws:s3:::build-artifacts/* # Just an example, customise as needed.
      Roles:
        - Ref: GitHubRole

  GitHubRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Statement:
          - Effect: Allow
            Action: sts:AssumeRoleWithWebIdentity
            Principal:
              Federated: !Ref GitHubOidc
            Condition:
              StringLike:
                # All GitHub Actions running in repositories within the Guardian GitHub organisation, customise as needed.
                vstoken.actions.githubusercontent.com:sub: repo:guardian/*

  GitHubOidc:
    Type: AWS::IAM::OIDCProvider
    Properties:
      Url: https://vstoken.actions.githubusercontent.com
      ClientIdList: [sigstore]

      # This is the thumbprint of `vstoken.actions.githubusercontent.com`
      # See: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc_verify-thumbprint.html
      ThumbprintList: [a031c46782e6e6c662c2c87c76da9aa62ccabd8e]

Outputs:
  GitHubRoleArn:
    # To be set as a secret in GitHub Actions
    Value: !GetAtt GitHubRole.Arn
```

## Usage
1. Add the `AWS::IAM::Role` ARN as a GitHub Actions [secret] (we'll assume the secret has been called `GU_ACTIONS_ROLE`)
2. Ensure your AWS credential provider chain includes `TokenFileWebIdentityCredentials` (or equivalent in other flavours of the AWS SDK)
3. Add `id-token` permissions to the GitHub Actions job:
    ```yaml
    name: CI
    on:
      pull_request:
      workflow_dispatch:
    jobs:
      CI:
        runs-on: ubuntu-latest
        permissions:
          id-token: write
          contents: read
    ```
4. Update your GitHub Actions workflow, adding the following step _before_ any request to AWS:
    ```yaml
    - uses: guardian/actions-assume-aws-role@v1
      with:
        awsRoleToAssume: ${{ secrets.GU_ACTIONS_ROLE }}
    ```

A full example would look something like this:

```yaml
name: CI
on:
  pull_request:
jobs:
  CI:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v2
      - uses: guardian/actions-assume-aws-role@v1
        with:
          awsRoleToAssume: ${{ secrets.GU_ACTIONS_ROLE }}
      - run: aws s3 cp artifact.zip s3://build-artifacts/actions-assume-aws-role/ci/artifact.zip # Just an example, customise as needed.
```

### Usage with `sbt-riffraff-artifact` and `node-riffraff-artifact`
[`sbt-riffraff-artifact`][riffraff-sbt] and [`node-riffraff-artifact`][riffraff-node] have been updated to work with `guardian/actions-assume-aws-role`.
See the documentation in those repositories for more information.

## Contributing
It should be as simple as:
  1. Clone the repository (`git clone git@github.com:guardian/actions-assume-aws-role.git`)
  2. Install dependencies (`npm install`)
  3. Make code changes
  4. Run tests and package for distribution (`npm run all`)
  5. Raise a PR
  6. [Version] the Action once your change has been merged to `main`


[@guardian/cdk]: https://github.com/guardian/cdk
[action]: https://github.com/features/actions
[aws-docs]: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html
[awsteele]: https://awsteele.com/blog/2021/09/15/aws-federation-comes-to-github-actions.html
[CI]: https://docs.github.com/en/actions/automating-builds-and-tests/about-continuous-integration
[riffraff-node]: https://github.com/guardian/node-riffraff-artifact
[riffraff-sbt]: https://github.com/guardian/sbt-riffraff-artifact
[secret]: https://docs.github.com/en/actions/security-guides/encrypted-secrets
[Version]: https://github.com/actions/toolkit/blob/master/docs/action-versioning.md
