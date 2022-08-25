# Practical Kubernetes

### Lesson Objective
Now our devcontainer can talk to K8s, we need to deploy redis and our application


### Step 1
Kubernetes makes use of namespaces to group sets of services together. We could create Redis in it's own namespace called `databases` or something that our SRE folks could monitor. Or, we could throw it in with our application to ensure that all the parts of our application are together. We'll take this opportunity to look at how Kuberenetes resolves DNS by putting redis in its own namespace.

First lets make sure that our K8s is configured OK.

From the command line run: `k config current-context`. You should see the result `docker-desktop`

Now we can check the namespaces that we currently have. The offical command is `k get namespaces` but kubectl is happy with abbreviations so we can simplify to `k get ns`

You should see something like:

NAME | STATUS | AGE
---|---|---
default | Active | 12d
kube-node-lease | Active | 12d
kube-public | Active | 12d
kube-system | Active | 12d

Lets get redis going by executing the following helm command

`helm install -n databases --create-namespace staging --set auth.password=shhSecret bitnami/redis`

This will create a namespace called databases and add in redis with the name `staging`

It says it'll take a while so we can check on the progress by typing `ket get pods -n databases -w`

You should see stuff like

NAME | READY | STATUS | RESTARTS | AGE
---|---|---|---|---
staging-redis-master-0 | 0/1 | Running | 0 | 8s
staging-redis-replicas-0 | 0/1 | Running | 0 | 8s
staging-redis-master-0 | 1/1 | Running | 0 | 36s

This is something you'll possibly be looking at quite a bit with K8s. The useful part for me was the restart count. K8s will restart a pod that's unhealthy so if you app goes in a crash loop or just experiences fatal bugs every now and again you can see the count here.

press `ctrl+c` to terminat the watch command

Now we can test stuff out like simulating a crash on one of the redis nodes.
Type the following
```bash
k -n databases delete pod staging-redis-replicas-0
```
followed by
```bash
k get pods -n databases
```
If you look at the age column you should see that the replica-0 has a much lower age than the others. This is neat for checking how concensus algorithms can affect your running code.

### Step 2
Build and deploy our application

We haven't actually built our lovely node app yet so lets do that by running the `buildImage.sh` file in the root
One it's complete type `docker image list | grep demonode`. You should see an entry in there with the tag `latest`

Kubernetes on docker for desktop will by default look at your local image registry before heading off to a pre-configured one (hub.docker.com) to look for images.

Let's get started with our deployment strategy. We're going to use Kustomize to allow for deployments to multiple environments with just a couple of tweaks.

Create a directory called `deployment` and inside there create two more called `base` and `overlays`

Inside of base create a file called `deployment.yaml`. This is the base unit of a deployment and lets us specify things such as how many instances we want to create, how we want to roll an update up and which image to use.

Copy the following to the file
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  namespace: app
  name: frontend-node
  labels:
    app: frontend-node
spec:
  replicas: 3
  selector:
    matchLabels:
      app: frontend-node
  template:
    metadata:
      name: frontend-node
      labels:
        app: frontend-node
    spec:
      containers:
      - name: app
        image: demonode:latest
        imagePullPolicy: IfNotPresent
        ports:
        - name: http
          containerPort: 8080
          protocol: TCP      
        env:
          - name: REDIS_CONNECTION_PATH
            value: /etc/redis-config/redisConnection.json
        volumeMounts:
        - name: redis-config-volume
          mountPath: "/etc/redis-config"
          readOnly: true
      volumes:
      - name: redis-config-volume
        secret:
          secretName: redis-config
          optional: false
```
Looking over this file there are couple of interesting items
* `kind`: `Deployment` - this tells Kubernetes what type of resource we're talking about. You can create your own resource types, but I have never done so
* `namespace`:`app` - this tells K8s the namespace we want our app located in
* `labels` - these are important to tell K8s how to apply other resources. Think of them a bit like CSS naming references
* `replicas`:`3` - how many instances we'd like to deploy. There isn't any point in changing that here as you'll see in a bit
* `containers` - Plural!! In docker the container is the atomic unit. In Kubernetes it's something called a pod. A pod can consist of multiple containers. We used this to deploy a `sidecar` to applications that contained framework logic. The application controller connected to the sidecar via gRPC. It made it very easy to control dependencies (Newtonsoft anyone 😊)
* `image`:`demonode:latest` - This is set to pull the latest image, almost never what you want. Specifying this here allows you to easily deploy different versions to different environments
* `env` - Sets environment variables within the container. In our app the location for the redis config comes from an environment variable, so we need to set that variable to point to the secret we'll mount in a second. The property name of the secret will be `redisConnection.json` so we set this value it to our mounted path + the secret name.
* `volumes` - Here we're creating a volume called `redis-config-volume` that gets its content from the secret called `redis-config`. We'll get to that in a bit.
* `volumeMounts` - References the volume we declare at the bottom, and then we tell it to mount at `/etc/redis-config`. So at this point we've essentially mapped a secret to a directory within our container. 

You can see that we expose some ports here, but they're locked up tight unless we declare a service that exposes them. Create a new file called `service.yaml` and drop this in it:
```yaml
apiVersion: v1
kind: Service
metadata:
  namespace: app
  name: frontend-service
spec:
  type: NodePort
  ports:
  - port: 8080
    targetPort: 8080
    nodePort: 31080
  selector:
    app: frontend-node
```
Key points here are:
* `type`:`NodePort` - This is only used for local development. Typically you would have a load balancer instead. Loadbalancers are often provided by the K8s hosting infrastructure e.g. Azure, Google
* `nodePort`:`31080` - This is the port that we can contant on the host (VM) to access our website. Within K8s it'll map to 8080, but docker desktop hooks us up to the node via localhost. 
* `selector`:`frontend-node` - This refers back to the CSS like rules I mentioned before. Using this we tell K8s which application we want to connect to within the cluster

If you remember we connect to redis to store our view count. If you look at `docker-compose.yml` in the `.devcontainer` folder you'll see and entry that looks like this:
```yaml
environment:
  - REDIS_CONNECTION_PATH=/workspace/redisConnection.json
```
And sure enough in our workspace you'll find a file called `redisConnection.json` that looks like this
```json
{
    "socket": {
        "host": "localhost",
        "port": 6379
    }
}
```
Now, we need to tell K8s how to connect to our Helm generated Redis cluster. We're going to take a shortcut here with regards to secrets, but we can come back to it if people want more K8s 😉

Create a new file under `deployment/base` called `secrets.yaml`. Set the content to this:
```yaml
apiVersion: v1
kind: Secret
metadata:
  namespace: app
  name: redis-config
type: Opaque
data: 
  redisConnection.json: novalue
```
We're going to leverage a tool called `Kustomize` to produce our deployments. Right now we're declaring what amounts to the abstract base class for our application deployment. Kustomize requires a specific file called `kustomization.yaml` so let's add that now. Set the content to this:
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - deployment.yaml
  - service.yaml
  - secrets.yaml
```
This is nice and easy. We're basically telling Kustomize which files we're interested in.

Now we're ready to start `Kustomizing` 🙄, so create a directory under `deployment\overlays` called `dev`.

We're going to overwrite the redis connection settings, so the easy way to that is to change the `redisConnection.json` file to look like this:

```json
{
    "socket": {
        "host": "staging-redis-master.databases",
        "port": 6379
    },
    "password": "shhSecret"
}
```
You should remember that password from the helm setup. Now in your bash terminal run `base64 ./redisConnection.json > temp.txt`, then open up that file. Remove the trailing whitespace to get it one just one line.


With that done add a file called `secrets.yaml` in the `deployment/overlay/dev` directory and drop this in:
```
apiVersion: v1
kind: Secret
metadata:
  namespace: app
  name: redis-config
type: Opaque
data: 
  redisConnection.json: ewogICAgInNvY2tldCI6IHsKICAgICAgICAiaG9zdCI6ICJzdGFnaW5nLXJlZGlzLW1hc3Rlci5kYXRhYmFzZXMiLAogICAgICAgICJwb3J0IjogNjM3OQogICAgfSwKICAgICJwYXNzd29yZCI6ICJzaGhTZWNyZXQiCn0=
```
That value for `redisConnection.json` should match the value you got in your temp.txt file.

Obviously base64 encoding a secret is a horrible idea 🤮, and I just want to re-iterate that this is a temp stopgap so we can progress further in this lab.

Our files here are quite small so there isn't much we can cut out, but in theory we just need the minimum amount of declaration to allow a nice merge between our base `secrets.yaml` file and this one here.

Let's create an overlay for our deployment now. Add the following content to a `deployment.yaml` file under `overlay/dev`
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  namespace: app
  name: frontend-node
  labels:
    app: frontend-node
spec:
  replicas: 1
```
This simply drops the number of replicas down to one instead of the 3 declared in the base.

The final step here is to add the `kustomization.yaml` file here and drop this in:
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
bases:
- ../../base
patchesStrategicMerge:
- deployment.yaml
- secrets.yaml
```
It's pretty straightforward, we tell it to use the base directory as a starting point then add a StrategicMerge patch for `deployment` and `secrets`. We're not making any service changes so we leave that as is. There are a couple of different strategies depending on what suits you best. 

At this point we're ready to deploy!
In your terminal type `k apply -k ./deployment/overlays/dev`. Alternatively if you want to create the yaml's for some build system to deploy you can run `k kustomize ./deployment/overlays/dev/ -o dev.yaml`

Once it has completed you should be able to go to [http://localhost:31080](http://localhost:31080) and view our web counter.

Type `k get pods -n app` to see our pod running, and `k get svc -n app` to see our node port. You can even do `k get secret redis-config -n app -o yaml` to see our secret in the flesh

### Step 3
Scale up

We want to scale up our site because lots of people are interested in [clicking buttons](https://clickspeedtest.com/).
Let's make a change to our dev environment first to test stuff out before deploying to production.

Open the app.js file and change what we write to:
```js
res.write(`Page Views: ${count}. Brought to you by ${process.env.HOSTNAME}`);
console.log(`Page Views: ${count}. Brought to you by ${process.env.HOSTNAME}`);
```
I figured we weren't logging anything and we'd like to know how each server is doing. Mostly we want our users to see how many different servers they can hit.

We don't want to mess around with production so we're going to label this image as something new. Open the `buildImage.sh` file and change it to 
```bash
#!/usr/bin/env bash
docker build -f Dockerfile -t demonode:withserver ./src
```
Then run it to make sure the image gets created in our repository.

Now we only want our dev environment to get this update for testing so head to the `deployment.yaml` file under `deployment/overlay/dev` and find the `replicas` section. Let's bump it up to something like 12. Next we want to change our image so we can add this under the `replicas`. Make sure the indentation is correct (`selector` should be inline with `replicas`).
```
selector:
    matchLabels:
      app: frontend-node
  template:
    metadata:
      name: frontend-node
      labels:
        app: frontend-node
    spec:
      containers:
      - name: app
        image: demonode:withserver
```
Notice the tag on the image has changed. 

Run the magic command of `k apply -k ./deployment/overlay/dev` to see the chagne. Note that it leaves the service and secret alone as there has been no change.

Refresh your page a few times and make sure that you're seeing a different server name pop up. The count should of course be going up by one each time as redis is shared.

### Step 4
Trouble shooting

We want to check that our pods are operating as expected. Run the following command 
```bash
k -n app logs frontend-node-<tab>
``` 
and keep typing a server name until it comes down to just one. You should now be able to see the output that we're logging each time. In a real system you'd likey have a sidecar or a daemon set that will scrape stdout and stderr to push to something like `elastic-stack`, `sumologic`, `splunk` or `Geneva`.

If you really need to get deep you can also execute the following
```
k -n app exec -it frontend-node-<tab> -- /bin/sh
```

You should now be connected to that container and you can now type 
```bash
cat /etc/redis-config/redisConnection.json
```
Whoops!!