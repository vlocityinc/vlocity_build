# base image
FROM node:14

# copy folders
COPY node-packages/ node-packages/
COPY sfdx-plugins/ sfdx-plugins/

## pre install env variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV SFDX_HIDE_RELEASE_NOTES=true

# install packages from http://deb.debian.org
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
 	gnupg \
	apt-utils \
	apt-transport-https \
	curl \
	wget \
	openssh-client \
	ca-certificates \
	jq \
	bc \
	gettext \
	xmlstarlet \
	bash \
	python3 \
	libxml2 \
	libxml2-utils \
	wget \
	openjdk-11-jre \
 && wget --quiet --output-document=- https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor > /etc/apt/trusted.gpg.d/google-archive.gpg \
 && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
 	google-chrome-stable \
	fonts-ipafont-gothic \
	fonts-wqy-zenhei \
	fonts-thai-tlwg \
	fonts-kacst \
	fonts-freefont-ttf \
	libxss1 \
	gh \
 && rm -rf /var/lib/apt/lists/*

# install packages from https://registry.npmjs.org
WORKDIR /node-packages
RUN cat ./package.json | jq '.devDependencies | keys[] as $k | "\($k)@\(.[$k])"' | xargs -t npm install --global

# install sfdx plugins from https://registry.npmjs.org
WORKDIR /sfdx-plugins
RUN chmod +x sfdx-plugins-installer.sh && ./sfdx-plugins-installer.sh

## post install env variables
ENV JAVA_HOME="/usr/lib/jvm/java-11-openjdk-amd64"
ENV PATH="$PATH:$JAVA_HOME/bin"
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome
ENV SFDX_AUTOUPDATE_DISABLE=false
ENV SFDX_JSON_TO_STDOUT=true
ENV SFDX_USE_GENERIC_UNIX_KEYCHAIN=true
ENV SFDX_DOMAIN_RETRY=true
ENV SFDX_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_CREATE=true
ENV SFDX_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_VERSION_CREATE=true
ENV SFDX_DISABLE_DNS_CHECK=true
ENV SHELL=/bin/bash

# tests
RUN java --version \
 && tsc -v \
 && sfdx --version \
 && sf --version \
 && sfdx plugins --core \
 && vlocity -v \
 && sfdx sgd -h \
 && gh --version 

# clean
RUN rm -f ~/.npmrc \
 && rm -rf /node-packages \
 && rm -rf /sfdx-plugins