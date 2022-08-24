# Practical Kubernetes

### Lesson Objective
We currently have a dev container image that is hooked up to use docker from the host machine. We need to setup kubernetes in a similar way so that we can issue commands from within this dev container

### Before we start
1. Ensure that you have Docker for Desktop installed and running
2. Ensure that you have used Docker for Desktop to install Kubernetes (no minikube)
3. Execute `git checkout start` on the repo
4. Open the project from a dev container either by opening in VSCode as normal then choosing `open in devcontainer` from the palette, or by running `devcontainer up` from the cmd terminal assuming you have the [CLI installed](https://code.visualstudio.com/docs/remote/devcontainer-cli)

### Step 1
First things first, let's make sure that our dev container has access to the kubernetes configuration from the host machine. We need to set an ENV variable on our devcontainer to do this.

Open the `devcontainer.json` file in the `.devcontainer` directory

At the bottom of the file insert this snippet (don't forget to add a , after `features'` closing scope):
```json
"remoteEnv": {
    "SYNC_LOCALHOST_KUBECONFIG": "true"
}
```

Now in our `docker-compose` file we need to mount our host machine's kubernetes config to the dev container. Open the `docker-compose.yml` file under the `.devcontainer` directory.
Find the mounts section that looks like this:
```yaml
volumes:
  - ..:/workspace:cached
```
and add this:
```yaml
- "${HOME}${USERPROFILE}/.kube:/usr/local/share/kube-localhost:bind"
```

### Step 2
When we use Kubernetes it'll try to connect on localhost as per the config. However, we need it to connect on host.docker.internal instead since we're inside the container (remember when we looked at the host file in `Practical Docker`?)

Luckily the fine folks at Microsoft have written all the code that's needed to do this, so create a directory called `scripts` under `.devcontainer` and then create a file called `copy-kube-config.sh`. Open up that file and paste this in
```bash
#!/bin/bash -i

# Copies localhost's ~/.kube/config file into the container and swap out localhost
# for host.docker.internal whenever a new shell starts to keep them in sync.
if [ "$SYNC_LOCALHOST_KUBECONFIG" = "true" ] && [ -d "/usr/local/share/kube-localhost" ]; then
    mkdir -p $HOME/.kube
    sudo cp -r /usr/local/share/kube-localhost/* $HOME/.kube
    sudo chown -R $(id -u) $HOME/.kube
    sed -i -e "s/localhost/host.docker.internal/g" $HOME/.kube/config
    sed -i -e "s/127.0.0.1/host.docker.internal/g" $HOME/.kube/config

    # If .minikube was mounted, set up client cert/key
    if [ -d "/usr/local/share/minikube-localhost" ]; then
        mkdir -p $HOME/.minikube
        sudo cp -r /usr/local/share/minikube-localhost/ca.crt $HOME/.minikube
        # Location varies between versions of minikube
        if [ -f "/usr/local/share/minikube-localhost/client.crt" ]; then
            sudo cp -r /usr/local/share/minikube-localhost/client.crt $HOME/.minikube
            sudo cp -r /usr/local/share/minikube-localhost/client.key $HOME/.minikube
        elif [ -f "/usr/local/share/minikube-localhost/profiles/minikube/client.crt" ]; then
            sudo cp -r /usr/local/share/minikube-localhost/profiles/minikube/client.crt $HOME/.minikube
            sudo cp -r /usr/local/share/minikube-localhost/profiles/minikube/client.key $HOME/.minikube
        fi
        sudo chown -R $(id -u) $HOME/.minikube

        # Point .kube/config to the correct locaiton of the certs
        sed -i -r "s|(\s*certificate-authority:\s).*|\\1$HOME\/.minikube\/ca.crt|g" $HOME/.kube/config
        sed -i -r "s|(\s*client-certificate:\s).*|\\1$HOME\/.minikube\/client.crt|g" $HOME/.kube/config
        sed -i -r "s|(\s*client-key:\s).*|\\1$HOME\/.minikube\/client.key|g" $HOME/.kube/config
    fi
fi
```
Run `chmod +x ./.devcontainer/scripts/copy-kube.config.sh` to ensure that we can execute the script

### Step 3
We've completed the steps to allow our devcontainer to connect to Kubernetes, but we haven't installed any of the tooling that we'll need! Let's update our `Dockerfile` to do that now

When you iteract with Kubernetes, you do so via `kubectl` (pronounced kube-control or kube-cuttle), so we need to get that going by adding this block after the `FROM` statement
```docker
# Install Kubectl
RUN curl -sSL -o /usr/local/bin/kubectl https://storage.googleapis.com/kubernetes-release/release/$(curl -s https://storage.googleapis.com/kubernetes-release/release/stable.txt)/bin/linux/amd64/kubectl \
    && chmod +x /usr/local/bin/kubectl

# Install Helm
RUN curl -s https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash -

COPY scripts/copy-kube-config.sh /usr/local/share/
RUN echo "source /usr/local/share/copy-kube-config.sh" | tee -a /root/.bashrc >> /root/.zshrc
```

First thing we're doing here is grabbing the latest stable kubernetes, you can change this to be variable driven like `NODE_VERSION` if you like.

Next we install `Helm`. Kubernetes is Greek for helmsman, hence the weird logo of a ship's helm for K8s. `Helm` is a bit like `nuget` or `npm` where you can download recipes for deploying all kinds of things in Kuberenetes such as `Redis` and `MongoDB`

Next we copy over the lovely localhost redirecting script and finally add a line in our bash and zsh configs to execute it

At this point we're pretty much good to go, but since this is `Practical` K8s we're going to make some quality of life changes that you'll likely find in any decent shop.

Find this section in the Dockerfile
```docker
# [Optional] Uncomment this section to install additional OS packages.
# RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
#     && apt-get -y install --no-install-recommends <your-package-list-here>
```
And replace it with this
```docker
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends bash-completion

RUN echo "source <(kubectl completion bash | sed s/kubectl/k/g)" | tee -a /root/.bashrc >> /root/.zshrc
RUN echo "source /etc/bash_completion" | tee -a /root/.bashrc >> /root/.zshrc
RUN echo "alias k=kubectl" | tee -a /root/.bashrc >> /root/.zshrc
RUN helm repo add bitnami https://charts.bitnami.com/bitnami
```
The first line will go and install a package called bash-completion for us, which does what you'd expect.

After that we setup `kubectl completion` and tee it off to bash and zsh (so that our dear programmers can choose their shell). Note that there is the weird looking `sed` statement. Well by default bash completion for K8s will only work if you type in `kubectl`, but almost everyone changes that to just `k`. The sed statement here will support either. Linux is often a weird world and despite the fact that we installed `bash-completion` it doesn't seem to kick in unless we explicitly add it to our shell config

Next up is shortening that woesome `kubectl` to just `k` so we can just write `k get pods -n foobar` when we want to see what's running.

Lastly just like `nuget` and `npm` we need to point our `helm` service at a repository. I've used `bitnami` in the past and it looks like there is some synergy with `Azure` so why not.

With all that done you `could` now rebuild your container and be on your way, but if you remember from the `Practical Docker` talk, each dockerfile statement leads to a layer being hashed and cached. We can keep our images smaller and simpler by reducing all those pesky `run` statements down to a single layer like this
```docker
RUN echo "source <(kubectl completion bash | sed s/kubectl/k/g)" | tee -a /root/.bashrc >> /root/.zshrc \
    && echo "source /etc/bash_completion" | tee -a /root/.bashrc >> /root/.zshrc \
    && echo "alias k=kubectl" | tee -a /root/.bashrc >> /root/.zshrc \
    && helm repo add bitnami https://charts.bitnami.com/bitnami
```
Note that we won't collapse the `apt-get` statement in case we decide we'll need more Linux packages at some point. If we run them all in together it can look a bit messy.

Finally, lets rebuild our dev container. Click in the green section in the lower left labelled `Dev Container: Practical Kubernetes` and choose `Rebuild Container`