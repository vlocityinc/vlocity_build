FROM node:8
RUN dpkg --add-architecture i386

RUN apt-get update
RUN apt-get install jq
RUN apt-get install -y libc6:i386 libstdc++6:i386

RUN npm install --global sfdx-cli 
RUN npm install --global publish-release 

RUN npm install --global pkg-fetch
RUN pkg-fetch -n node8 -p win -a x64
RUN pkg-fetch -n node8 -p win -a x86
RUN pkg-fetch -n node8 -p linux -a x64
RUN pkg-fetch -n node8 -p linux -a x86
RUN pkg-fetch -n node8 -p macos -a x64

RUN npm install --global pkg

# declare /vlocity_build as working directory of image
WORKDIR /vlocity_build

COPY ./package*.json /vlocity_build/

RUN npm install

# Important to do this final part last because of how docker builds image
# copy all remaining files/folders in project directory to the container
COPY . /vlocity_build